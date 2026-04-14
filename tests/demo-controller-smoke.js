(function() {
  var results = [];

  var assert = function(condition, message) {
    results.push({ pass: !!condition, message: message });
  };

  assert(!!window.demoScenes, 'demoScenes should be exposed on window');
  assert(window.demoScenes && typeof window.demoScenes.getAll === 'function',
         'demoScenes.getAll should exist');
  if (window.demoScenes && typeof window.demoScenes.getAll === 'function') {
    var scenes = window.demoScenes.getAll();
    assert(Array.isArray(scenes), 'demoScenes.getAll should return an array');
    assert(scenes.length === 2, 'demoScenes.getAll should return exactly two scenes');
    var titles = scenes.map(function(scene) { return scene.title; }).sort();
    var expectedTitles = ['冲突日志覆盖演示', '故障恢复与日志追平'].sort();
    assert(JSON.stringify(titles) === JSON.stringify(expectedTitles),
           'scene titles should match the task requirements');
    var allStepsHavePauseMessage = scenes.every(function(scene) {
      return Array.isArray(scene.steps) && scene.steps.length >= 2 &&
        scene.steps.every(function(step) {
          return typeof step.pauseMessage === 'string' && step.pauseMessage.length > 0;
        });
    });
    assert(allStepsHavePauseMessage, 'every step should include a pauseMessage');
  }

  assert(typeof window.createDemoController === 'function',
         'createDemoController should be exposed on window');

  if (typeof window.createDemoController === 'function') {
    var pauseCalls = 0;
    var resumeCalls = 0;
    var controller = window.createDemoController({
      playback: {
        pause: function() { pauseCalls += 1; },
        resume: function() { resumeCalls += 1; }
      },
      onStateChange: function() {}
    });

    assert(typeof controller.start === 'function', 'controller.start should exist');
    assert(typeof controller.advance === 'function', 'controller.advance should exist');
    assert(typeof controller.stop === 'function', 'controller.stop should exist');
    assert(typeof controller.afterUpdate === 'function', 'controller.afterUpdate should exist');
    assert(typeof controller.getStatus === 'function', 'controller.getStatus should exist');

    var actionCalls = [0, 0];
    var checkCalls = [0, 0];
    var context = { readyFirst: false, readySecond: false };
    var scene = {
      id: 'smoke-scene',
      title: 'Smoke Scene',
      steps: [{
        title: 'step-1',
        description: 'first step',
        pauseMessage: 'pause 1',
        action: function(ctx) {
          actionCalls[0] += 1;
          ctx.firstActionDone = true;
        },
        check: function(ctx) {
          checkCalls[0] += 1;
          return !!ctx.readyFirst;
        }
      }, {
        title: 'step-2',
        description: 'second step',
        pauseMessage: 'pause 2',
        action: function(ctx) {
          actionCalls[1] += 1;
          ctx.secondActionDone = true;
        },
        check: function(ctx) {
          checkCalls[1] += 1;
          return !!ctx.readySecond;
        }
      }]
    };
    controller.start(scene, context);
    var status = controller.getStatus();
    assert(status, 'getStatus should return a snapshot after start');
    var sceneSnapshot = status.scene;
    assert(sceneSnapshot !== scene, 'status.scene should be cloned');
    assert(sceneSnapshot.id === scene.id, 'cloned scene retains id');
    assert(sceneSnapshot.title === scene.title, 'cloned scene retains title');
    assert(Array.isArray(sceneSnapshot.steps), 'scene.steps should exist after cloning');
    assert(sceneSnapshot.steps !== scene.steps, 'steps array should be cloned');
    assert(sceneSnapshot.steps[0] !== scene.steps[0], 'step objects should be cloned');
    assert(sceneSnapshot.steps[0].pauseMessage === scene.steps[0].pauseMessage,
           'step pauseMessage stays intact');
    assert(status.active === true, 'status.active should be true after start');
    assert(status.stepStarted === false, 'status.stepStarted should default to false');
    assert(status.waitingForAdvance === false, 'status.waitingForAdvance should default to false');
    assert(status.pausedForNarration === false, 'status.pausedForNarration should default to false');
    assert(status.completed === false, 'status.completed should default to false');
    assert(status.stepIndex === 0, 'status.stepIndex should start at zero');

    controller.afterUpdate();
    status = controller.getStatus();
    assert(actionCalls[0] === 1, 'first step action should run once after first update');
    assert(checkCalls[0] === 1, 'first step check should run after action');
    assert(status.stepStarted === true, 'step should be marked as started after first update');
    assert(status.waitingForAdvance === false, 'should not wait before first check passes');
    assert(pauseCalls === 0, 'playback.pause should not run before first check passes');

    controller.afterUpdate();
    assert(actionCalls[0] === 1, 'first step action should not rerun while waiting for check');
    assert(checkCalls[0] === 2, 'first step check should keep polling until it passes');

    context.readyFirst = true;
    controller.afterUpdate();
    status = controller.getStatus();
    assert(status.waitingForAdvance === true, 'controller should wait for manual advance after check passes');
    assert(status.pausedForNarration === true, 'controller should mark pausedForNarration after check passes');
    assert(pauseCalls === 1, 'playback.pause should run once for the first completed step');

    controller.afterUpdate();
    assert(actionCalls[0] === 1, 'waiting state should not rerun first action');
    assert(checkCalls[0] === 3, 'waiting state should stop polling first step check');

    controller.advance();
    status = controller.getStatus();
    assert(status.stepIndex === 1, 'advance should move to next step');
    assert(status.stepStarted === false, 'next step should not be started immediately');
    assert(status.waitingForAdvance === false, 'advance should clear waiting flag');
    assert(status.pausedForNarration === false, 'advance should clear pausedForNarration flag');

    controller.afterUpdate();
    status = controller.getStatus();
    assert(actionCalls[1] === 1, 'second step action should run once');
    assert(checkCalls[1] === 1, 'second step check should run');
    assert(status.waitingForAdvance === false, 'second step should continue while check is false');

    context.readySecond = true;
    controller.afterUpdate();
    status = controller.getStatus();
    assert(status.waitingForAdvance === true, 'second step should also wait after check passes');
    assert(status.pausedForNarration === true, 'second step should pause narration after completion');
    assert(pauseCalls === 2, 'playback.pause should run again for second step');

    controller.advance();
    status = controller.getStatus();
    assert(status.completed === true, 'scene should be marked completed after final advance');
    assert(status.active === false, 'scene should be inactive after final advance');
    assert(status.waitingForAdvance === false, 'completed scene should not wait for advance');
    assert(status.scene && status.scene.id === scene.id, 'completed snapshot should still keep scene metadata');
    assert(resumeCalls >= 1, 'playback.resume should be used when advancing unfinished scenes');

    controller.stop();
    assert(controller.getStatus() === null, 'getStatus should be null after stop');
  }

  window.renderSmokeResults(results);
})();
