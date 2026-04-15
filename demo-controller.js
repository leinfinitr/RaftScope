(function(global) {
  'use strict';

  global.createDemoController = function(options) {
    options = options || {};
    var playback = options.playback || {};
    var internalState = null;

    function cloneStep(step) {
      if (!step)
        return step;
      return Object.assign({}, step);
    }

    function cloneScene(scene) {
      if (!scene) {
        return null;
      }
      var clone = Object.assign({}, scene);
      var steps = scene.steps;
      if (Array.isArray(steps)) {
        clone.steps = steps.map(function(step) {
          return cloneStep(step);
        });
      } else {
        clone.steps = [];
      }
      return clone;
    }

    function hasStepAt(scene, index) {
      return !!(scene && Array.isArray(scene.steps) &&
                index >= 0 && index < scene.steps.length);
    }

    function completeState(value) {
      value.active = false;
      value.completed = true;
      value.waitingForAdvance = false;
      value.pausedForNarration = false;
      value.stepStarted = false;
    }

    function getContextTime(context) {
      if (!context || typeof context.model !== 'function') {
        return 0;
      }
      var model = context.model();
      if (!model || typeof model.time !== 'number') {
        return 0;
      }
      return model.time;
    }

    function logStepComplete(value) {
      if (!value || !value.context || typeof value.context.log !== 'function') {
        return;
      }
      value.context.log('步骤' + (value.stepIndex + 1) + ': 完成');
    }

    function logSceneCompletion(value) {
      if (!value || !value.context || typeof value.context.log !== 'function') {
        return;
      }
      if (!value.scene || !Array.isArray(value.scene.completionMessages)) {
        return;
      }
      value.scene.completionMessages.forEach(function(message) {
        value.context.log(message);
      });
    }

    function getSnapshot(value) {
      if (!value) {
        return null;
      }
      return {
        active: value.active,
        scene: cloneScene(value.scene),
        stepIndex: value.stepIndex,
        stepStarted: value.stepStarted,
        stepStartedAt: value.stepStartedAt,
        waitingForAdvance: value.waitingForAdvance,
        pausedForNarration: value.pausedForNarration,
        completed: value.completed
      };
    }

    function getSerializedState(value) {
      if (!value || !value.scene || !value.scene.id) {
        return null;
      }
      return {
        active: value.active,
        completed: value.completed,
        sceneId: value.scene.id,
        stepIndex: value.stepIndex,
        stepStarted: value.stepStarted,
        stepStartedAt: value.stepStartedAt,
        waitingForAdvance: value.waitingForAdvance,
        pausedForNarration: value.pausedForNarration
      };
    }

    function notifyStateChange(value) {
      if (typeof options.onStateChange === 'function') {
        options.onStateChange(getSnapshot(value));
      }
    }

    function safelyPausePlayback() {
      if (typeof playback.pause === 'function') {
        playback.pause();
      }
    }

    function safelyResumePlayback() {
      if (typeof playback.resume === 'function') {
        playback.resume();
      }
    }

    function runStepAction(step, context) {
      if (typeof step.action === 'function') {
        step.action(context);
      }
    }

    function runStepCheck(step, context) {
      if (typeof step.check === 'function') {
        return !!step.check(context);
      }
      return true;
    }

    return {
      start: function(scene, context) {
        var clonedScene = cloneScene(scene || {});
        var hasSteps = hasStepAt(clonedScene, 0);
        internalState = {
          scene: clonedScene,
          context: context || {},
          active: hasSteps,
          completed: !hasSteps,
          stepIndex: 0,
          stepStarted: false,
          stepStartedAt: 0,
          waitingForAdvance: false,
          pausedForNarration: false,
        };
        notifyStateChange(internalState);
      },
      serialize: function() {
        return getSerializedState(internalState);
      },
      restore: function(snapshot, scene, context) {
        if (!snapshot || !scene) {
          internalState = null;
          notifyStateChange(internalState);
          return;
        }

        var clonedScene = cloneScene(scene);
        internalState = {
          scene: clonedScene,
          context: context || {},
          active: !!snapshot.active,
          completed: !!snapshot.completed,
          stepIndex: typeof snapshot.stepIndex === 'number' ? snapshot.stepIndex : 0,
          stepStarted: !!snapshot.stepStarted,
          stepStartedAt: typeof snapshot.stepStartedAt === 'number' ? snapshot.stepStartedAt : 0,
          waitingForAdvance: !!snapshot.waitingForAdvance,
          pausedForNarration: !!snapshot.pausedForNarration,
        };

        if (!hasStepAt(clonedScene, internalState.stepIndex) && !internalState.completed) {
          completeState(internalState);
        }
        notifyStateChange(internalState);
      },
      advance: function() {
        return false;
      },
      stop: function() {
        internalState = null;
        notifyStateChange(internalState);
      },
      beforeUpdate: function() {
        if (!internalState || !internalState.active || internalState.completed ||
            internalState.waitingForAdvance) {
          return;
        }

        if (!hasStepAt(internalState.scene, internalState.stepIndex)) {
          completeState(internalState);
          notifyStateChange(internalState);
          return;
        }

        var step = internalState.scene.steps[internalState.stepIndex];
        if (!internalState.stepStarted) {
          runStepAction(step, internalState.context);
          internalState.stepStarted = true;
          internalState.stepStartedAt = getContextTime(internalState.context);
          notifyStateChange(internalState);
        }
      },
      afterUpdate: function() {
        if (!internalState || !internalState.active || internalState.completed ||
            internalState.waitingForAdvance || !internalState.stepStarted) {
          return;
        }

        var step = internalState.scene.steps[internalState.stepIndex];
        if (runStepCheck(step, internalState.context)) {
          var minimumElapsed = typeof step.minimumElapsed === 'number' ? step.minimumElapsed : 0;
          var elapsed = getContextTime(internalState.context) - internalState.stepStartedAt;
          if (elapsed < minimumElapsed) {
            notifyStateChange(internalState);
            return;
          }
          logStepComplete(internalState);
          if (!hasStepAt(internalState.scene, internalState.stepIndex + 1)) {
            completeState(internalState);
            logSceneCompletion(internalState);
          } else {
            internalState.stepIndex += 1;
            internalState.stepStarted = false;
            internalState.stepStartedAt = 0;
            internalState.waitingForAdvance = false;
            internalState.pausedForNarration = false;
          }
        }
        notifyStateChange(internalState);
      },
      getStatus: function() {
        return getSnapshot(internalState);
      }
    };
  };
})(window);
