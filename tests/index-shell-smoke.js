(function(global) {
  'use strict';

  var REQUIRED_IDS = [
    'app-shell',
    'scene-status-badge',
    'legend-panel',
    'step-card',
    'continue-scene',
    'stop-scene',
    'start-recovery-scene',
    'start-overwrite-scene'
  ];

  var getById = function(frameDocument, id) {
    if (!frameDocument || typeof frameDocument.getElementById !== 'function') {
      return null;
    }
    return frameDocument.getElementById(id);
  };

  var getNodeText = function(node) {
    if (!node) {
      return '';
    }
    var raw = '';
    if (typeof node.innerText === 'string') {
      raw = node.innerText;
    } else if (typeof node.textContent === 'string') {
      raw = node.textContent;
    }
    return raw.replace(/\s+/g, ' ').trim();
  };

  var clickNode = function(node, frameWindow) {
    if (!node) {
      return false;
    }
    if (typeof node.click === 'function') {
      node.click();
      return true;
    }
    if (frameWindow && typeof frameWindow.MouseEvent === 'function' &&
        typeof node.dispatchEvent === 'function') {
      node.dispatchEvent(new frameWindow.MouseEvent('click', {
        bubbles: true,
        cancelable: true
      }));
      return true;
    }
    return false;
  };

  global.runIndexShellSmoke = function(frameWindow, assert) {
    var frameDocument = frameWindow && frameWindow.document;
    assert(!!frameDocument, 'iframe document should be available');
    if (!frameDocument) {
      return;
    }

    REQUIRED_IDS.forEach(function(id) {
      var node = getById(frameDocument, id);
      assert(!!node, '#' + id + ' should exist');
    });

    var bodyNode = frameDocument.body;
    assert(!!bodyNode, 'document body should exist');
    if (bodyNode && frameWindow && typeof frameWindow.getComputedStyle === 'function') {
      var bodyStyle = frameWindow.getComputedStyle(bodyNode);
      var bodyBackgroundImage = bodyStyle && bodyStyle.backgroundImage;
      assert(typeof bodyBackgroundImage === 'string' &&
        bodyBackgroundImage !== 'none' &&
        bodyBackgroundImage.toLowerCase().indexOf('gradient') !== -1,
        'body should use a non-default gradient background');
    }

    var appShell = getById(frameDocument, 'app-shell');
    if (appShell && frameWindow && typeof frameWindow.getComputedStyle === 'function') {
      var appShellStyle = frameWindow.getComputedStyle(appShell);
      var appShellMaxWidth = appShellStyle && appShellStyle.maxWidth;
      var parsedMaxWidth = parseFloat(appShellMaxWidth);
      assert(typeof appShellMaxWidth === 'string' &&
        appShellMaxWidth !== 'none' &&
        !isNaN(parsedMaxWidth) &&
        parsedMaxWidth > 0,
        '#app-shell should define a bounded max-width');
    }

    var svgNode = null;
    if (typeof frameDocument.querySelector === 'function') {
      svgNode = frameDocument.querySelector('svg');
    }
    assert(!!svgNode, 'svg should exist');

    var modalDetails = getById(frameDocument, 'modal-details');
    assert(!!modalDetails, '#modal-details should exist');

    var helpModal = getById(frameDocument, 'modal-help');
    assert(!!helpModal, '#modal-help should exist');
    assert(getNodeText(helpModal).indexOf('Set up log replication start scenario') === -1,
      'help modal should not include removed log replication setup shortcut');

    var contextMenu = getById(frameDocument, 'context-menu');
    assert(!!contextMenu, '#context-menu should exist');

    var helpBodyText = getNodeText(frameDocument.body);
    assert(helpBodyText.indexOf('Set up log replication start scenario') === -1,
      'help text should not contain removed L shortcut scenario');
    if (typeof frameDocument.querySelectorAll === 'function') {
      var nodeLegendRows = frameDocument.querySelectorAll('.legend-node-row');
      assert(nodeLegendRows.length === 3,
        'node legend should render three rows for term colors, leader label, and timer ring');
      var messageLegendChips = frameDocument.querySelectorAll('.legend-message-chip');
      assert(messageLegendChips.length === 3,
        'legend should distinguish RequestVote, AppendEntries, and heartbeat with separate chips');
      var messageLegendRows = frameDocument.querySelectorAll('.legend-message-row');
      assert(messageLegendRows.length === 3,
        'message legend should render one legend row per message type');
      var logLegendRows = frameDocument.querySelectorAll('.legend-log-row');
      assert(logLegendRows.length === 2,
        'log legend should render separate rows for committed and uncommitted entries');
    }
    var leaderLegendText = null;
    if (typeof frameDocument.querySelector === 'function') {
      leaderLegendText = frameDocument.querySelector('.legend-leader-text');
    }
    assert(!!leaderLegendText, 'legend should highlight the leader color word');
    if (leaderLegendText && frameWindow && typeof frameWindow.getComputedStyle === 'function') {
      var leaderLegendStyle = frameWindow.getComputedStyle(leaderLegendText);
      assert(leaderLegendStyle &&
        leaderLegendStyle.color !== 'rgb(0, 0, 0)' &&
        leaderLegendStyle.color !== 'rgba(0, 0, 0, 1)',
        'leader color word should render in red instead of default text color');
    }

    var badge = getById(frameDocument, 'scene-status-badge');
    var startRecovery = getById(frameDocument, 'start-recovery-scene');
    var stopScene = getById(frameDocument, 'stop-scene');
    var continueScene = getById(frameDocument, 'continue-scene');
    var timeIcon = getById(frameDocument, 'time-icon');
    var initialBadgeText = getNodeText(badge);
    assert(initialBadgeText.length > 0, 'scene badge should have initial text');
    assert(getNodeText(stopScene) === '重置为初始状态',
      'stop button should be renamed to reset initial state');
    assert(!!timeIcon && /glyphicon-pause/.test(timeIcon.className),
      'page should start paused');

    var startClicked = clickNode(startRecovery, frameWindow);
    assert(startClicked, 'start recovery button should be clickable');
    var startedBadgeText = getNodeText(badge);
    assert(startedBadgeText.length > 0 &&
      startedBadgeText !== initialBadgeText,
      'scene badge text should change after starting recovery scene');
    assert(!!stopScene && stopScene.disabled === false,
      'stop button should be enabled after starting recovery scene');
    assert(!!continueScene && continueScene.disabled === true,
      'continue button should stay disabled when scenes no longer auto-pause');
    assert(!!timeIcon && /glyphicon-pause/.test(timeIcon.className),
      'starting a scene should keep the simulation paused until manual play');
    if (typeof startRecovery.focus === 'function') {
      startRecovery.focus();
      clickNode(startRecovery, frameWindow);
      assert(frameDocument.activeElement !== startRecovery,
        'starting a scene should clear button focus so the space shortcut can start playback');
    }
    if (frameWindow && typeof frameWindow.KeyboardEvent === 'function' &&
        typeof frameWindow.dispatchEvent === 'function') {
      frameWindow.dispatchEvent(new frameWindow.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' ',
        code: 'Space',
        keyCode: 32,
        which: 32
      }));
      assert(!!timeIcon && /glyphicon-time/.test(timeIcon.className),
        'pressing space should start a newly entered scene');
    }
    if (frameWindow && frameWindow.playback &&
        typeof frameWindow.playback.pause === 'function') {
      frameWindow.playback.pause();
    }
    if (frameWindow && frameWindow.state &&
        typeof frameWindow.state.seek === 'function' &&
        frameWindow.render &&
        typeof frameWindow.render.update === 'function') {
      frameWindow.state.seek(260000);
      frameWindow.render.update();
      if (frameWindow.$ &&
          typeof frameWindow.$ === 'function') {
        frameWindow.$('#time').slider('setValue', 160000);
        frameWindow.$('#time').trigger('slideStart');
        frameWindow.$('#time').trigger('slide');
        frameWindow.$('#time').trigger('slideStop');
      }
      assert(getNodeText(badge).indexOf('故障恢复与日志追平') !== -1,
        'dragging the timeline should keep the recovery scene active');
    }

    var stopClicked = clickNode(stopScene, frameWindow);
    assert(stopClicked, 'stop scene button should be clickable');
    var stoppedBadgeText = getNodeText(badge);
    assert(stoppedBadgeText === initialBadgeText,
      'scene badge should return to manual mode after stop');
    assert(!!continueScene && continueScene.disabled === true,
      'continue button should be disabled after stop');
    assert(!!timeIcon && /glyphicon-pause/.test(timeIcon.className),
      'reset should leave the simulation paused');

    var overwriteClicked = clickNode(getById(frameDocument, 'start-overwrite-scene'),
      frameWindow);
    assert(overwriteClicked, 'start overwrite button should be clickable');
    if (frameWindow && frameWindow.state &&
        typeof frameWindow.state.seek === 'function' &&
        frameWindow.render &&
        typeof frameWindow.render.update === 'function') {
      frameWindow.state.seek(260000);
      frameWindow.render.update();
      if (frameWindow.$ &&
          typeof frameWindow.$ === 'function') {
        frameWindow.$('#time').slider('setValue', 140000);
        frameWindow.$('#time').trigger('slideStart');
        frameWindow.$('#time').trigger('slide');
        frameWindow.$('#time').trigger('slideStop');
      }
      assert(getNodeText(badge).indexOf('冲突日志覆盖演示') !== -1,
        'dragging the timeline should keep the overwrite scene active');
    }
  };
})(window);
