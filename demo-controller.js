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
        waitingForAdvance: value.waitingForAdvance,
        pausedForNarration: value.pausedForNarration,
        completed: value.completed
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
          waitingForAdvance: false,
          pausedForNarration: false,
        };
        notifyStateChange(internalState);
      },
      advance: function() {
        return false;
      },
      stop: function() {
        internalState = null;
        notifyStateChange(internalState);
      },
      afterUpdate: function() {
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
        }

        if (runStepCheck(step, internalState.context)) {
          logStepComplete(internalState);
          if (!hasStepAt(internalState.scene, internalState.stepIndex + 1)) {
            completeState(internalState);
            logSceneCompletion(internalState);
          } else {
            internalState.stepIndex += 1;
            internalState.stepStarted = false;
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
