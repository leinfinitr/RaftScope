const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return function() {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBrowserScripts(seed) {
  const context = {
    console: console,
    Math: Object.create(Math),
    window: {},
    document: {},
    $: {
      map: function(object, iteratee) {
        return Object.keys(object).map(function(key) {
          return iteratee(object[key], key);
        });
      }
    },
    jQuery: {
      extend: function(deep, target, source) {
        return deepClone(source);
      }
    }
  };
  context.window = context;
  context.global = context;
  context.Math.random = createSeededRandom(seed);
  vm.createContext(context);

  [
    'util.js',
    'raft.js',
    'demo-scenes.js',
    'demo-controller.js'
  ].forEach(function(relativePath) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    vm.runInContext(source, context, { filename: absolutePath });
  });

  return context;
}

function buildPeers(serverId, totalServers) {
  const peers = [];
  for (let id = 1; id <= totalServers; id += 1) {
    if (id !== serverId) {
      peers.push(id);
    }
  }
  return peers;
}

function createModel(raft, totalServers) {
  return {
    time: 0,
    messages: [],
    servers: Array.from({ length: totalServers }, function(_, index) {
      const serverId = index + 1;
      return raft.server(serverId, buildPeers(serverId, totalServers));
    })
  };
}

function createSceneHarness(seed) {
  const context = loadBrowserScripts(seed);
  const raft = context.raft;
  const totalServers = 5;
  const model = createModel(raft, totalServers);
  const playback = {
    pause: function() {},
    resume: function() {}
  };
  const controller = context.createDemoController({
    playback: playback,
    onStateChange: function() {}
  });

  const resetCluster = function() {
    model.time = 0;
    model.messages = [];
    model.servers = Array.from({ length: totalServers }, function(_, index) {
      const serverId = index + 1;
      return raft.server(serverId, buildPeers(serverId, totalServers));
    });
    raft.enableAppendEntries = true;
  };

  const sceneContext = {
    model: function() {
      return model;
    },
    log: function() {},
    server: function(id) {
      return model.servers[id - 1];
    },
    resetCluster: resetCluster,
    forceLeader: function(id) {
      return model.servers[id - 1];
    },
    networkFail: function(id) {
      raft.networkFailure(model, model.servers[id - 1]);
    },
    networkRecover: function(id) {
      raft.networkRecovery(model, model.servers[id - 1]);
    },
    clientRequest: function(id) {
      raft.clientRequest(model, model.servers[id - 1]);
    },
    timeout: function(id) {
      raft.timeout(model, model.servers[id - 1]);
    },
    rules: function() {
      return raft.rules;
    },
    countTrue: function(values) {
      return values.filter(Boolean).length;
    },
    mapValues: function(valueMap) {
      return Object.keys(valueMap).map(function(key) {
        return valueMap[key];
      });
    },
    constants: function() {
      return {
        ELECTION_TIMEOUT: 100000,
        NUM_SERVERS: totalServers,
        INF: context.util.Inf
      };
    },
    setAppendEntriesEnabled: function(enabled) {
      raft.enableAppendEntries = !!enabled;
    },
    reset: function() {}
  };

  const getSceneById = function(sceneId) {
    return context.demoScenes.getAll().filter(function(scene) {
      return scene.id === sceneId;
    })[0];
  };

  return {
    context: context,
    controller: controller,
    model: model,
    raft: raft,
    sceneContext: sceneContext,
    getSceneById: getSceneById
  };
}

function createRaftHarness(seed) {
  const context = loadBrowserScripts(seed);
  return {
    context: context,
    raft: context.raft,
    util: context.util,
    model: createModel(context.raft, 5)
  };
}

function captureLeaderMatchIndex(model, leaderId) {
  return deepClone(model.servers[leaderId - 1].matchIndex);
}

function runUntilSceneStep(options) {
  const harness = createSceneHarness(options.seed);
  const controller = harness.controller;
  const model = harness.model;
  const raft = harness.raft;
  const scene = harness.getSceneById(options.sceneId);
  let captured = null;

  controller.start(scene, harness.sceneContext);

  for (let tick = 0; tick < options.maxTicks; tick += 1) {
    controller.beforeUpdate();
    const status = controller.getStatus();
    if (status &&
        status.stepIndex === options.targetStepIndex &&
        status.stepStarted) {
      captured = {
        time: model.time,
        status: status,
        logs: model.servers.map(function(server) {
          return server.log.length;
        }),
        leaderMatchIndex: captureLeaderMatchIndex(model, options.leaderId),
        servers: deepClone(model.servers),
        messages: deepClone(model.messages)
      };
      break;
    }
    model.time += options.tickDuration;
    raft.update(model);
    controller.afterUpdate();
  }

  if (!captured) {
    throw new Error(
      'did not reach step ' + (options.targetStepIndex + 1) +
      ' in scene ' + options.sceneId
    );
  }

  return captured;
}

function countSceneMessages(options) {
  const harness = createSceneHarness(options.seed);
  const controller = harness.controller;
  const model = harness.model;
  const raft = harness.raft;
  const scene = harness.getSceneById(options.sceneId);
  const seenMessages = new Set();
  let counting = false;
  let count = 0;

  function collectMessages() {
    model.messages.forEach(function(message) {
      if (seenMessages.has(message)) {
        return;
      }
      seenMessages.add(message);
      if (counting && options.filter(message)) {
        count += 1;
      }
    });
  }

  controller.start(scene, harness.sceneContext);

  for (let tick = 0; tick < options.maxTicks; tick += 1) {
    controller.beforeUpdate();
    var status = controller.getStatus();
    if (status && status.stepIndex === options.startStepIndex) {
      counting = true;
    }
    collectMessages();
    model.time += options.tickDuration;
    raft.update(model);
    controller.afterUpdate();
    status = controller.getStatus();
    collectMessages();
    if (status && status.stepIndex >= options.stopStepIndex) {
      return count;
    }
  }

  throw new Error(
    'did not reach step ' + (options.stopStepIndex + 1) +
    ' while counting messages in scene ' + options.sceneId
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testRecoverySceneWaitsForFirstRequestToDrain() {
  const result = runUntilSceneStep({
    seed: 7,
    sceneId: 'failure-recovery-log-catchup',
    targetStepIndex: 2,
    leaderId: 1,
    tickDuration: 50000,
    maxTicks: 2000
  });

  assert(
    result.logs.slice(1).every(function(logLength) {
      return logLength >= 1;
    }),
    'step 3 should not start before every follower has the first log entry'
  );
  assert(
    Object.keys(result.leaderMatchIndex).every(function(peerId) {
      return result.leaderMatchIndex[peerId] >= 1;
    }),
    'step 3 should not start before Server 1 has acknowledgements for the first entry from every follower'
  );
}

function testRecoverySceneWaitsForSecondRequestToDrainBeforeCrash() {
  const result = runUntilSceneStep({
    seed: 7,
    sceneId: 'failure-recovery-log-catchup',
    targetStepIndex: 3,
    leaderId: 1,
    tickDuration: 50000,
    maxTicks: 2000
  });

  assert(
    result.logs.every(function(logLength) {
      return logLength >= 2;
    }),
    'step 4 should not start before every server has both replicated entries'
  );
  assert(
    Object.keys(result.leaderMatchIndex).every(function(peerId) {
      return result.leaderMatchIndex[peerId] >= 2;
    }),
    'step 4 should not start before Server 1 has acknowledgements for both replicated entries'
  );
}

function testDemoControllerCanSerializeAndRestore() {
  const context = loadBrowserScripts(11);
  const controller = context.createDemoController({
    playback: {
      pause: function() {},
      resume: function() {}
    },
    onStateChange: function() {}
  });

  const runtimeContext = {
    currentTime: 0,
    readyFirst: false,
    readySecond: false,
    model: function() {
      return { time: this.currentTime };
    }
  };
  const scene = {
    id: 'restore-smoke',
    title: 'Restore Smoke',
    steps: [{
      title: 'first',
      description: 'first step',
      pauseMessage: 'pause first',
      minimumElapsed: 5,
      action: function() {},
      check: function(ctx) {
        return !!ctx.readyFirst;
      }
    }, {
      title: 'second',
      description: 'second step',
      pauseMessage: 'pause second',
      minimumElapsed: 5,
      action: function() {},
      check: function(ctx) {
        return !!ctx.readySecond;
      }
    }]
  };

  controller.start(scene, runtimeContext);
  controller.beforeUpdate();
  runtimeContext.readyFirst = true;
  runtimeContext.currentTime = 5;
  controller.afterUpdate();

  const serialized = controller.serialize();
  assert(!!serialized, 'serialize should return a checkpoint snapshot');
  assert(serialized.sceneId === scene.id, 'serialize should preserve the scene id');
  assert(serialized.stepIndex === 1, 'serialize should preserve the active step index');

  runtimeContext.readySecond = true;
  runtimeContext.currentTime = 10;
  controller.beforeUpdate();
  controller.afterUpdate();
  runtimeContext.currentTime = 15;
  controller.beforeUpdate();
  controller.afterUpdate();
  assert(controller.getStatus().completed === true,
    'controller should complete after the second step before restore');

  controller.restore(serialized, scene, runtimeContext);
  const restored = controller.getStatus();
  assert(!!restored, 'restore should reactivate the controller');
  assert(restored.completed === false, 'restore should bring the controller back to the saved point');
  assert(restored.stepIndex === 1, 'restore should reset the active step index');
  assert(restored.scene && restored.scene.id === scene.id,
    'restore should rebuild the scene metadata from the saved snapshot');
}

function testNetworkFailureDropsInflightAppendEntries() {
  const harness = createRaftHarness(17);
  const raft = harness.raft;
  const util = harness.util;
  const model = harness.model;
  const leader = model.servers[0];
  const follower = model.servers[2];

  leader.state = 'leader';
  leader.term = 3;
  leader.log = [{ term: 3, value: 'v' }];
  leader.matchIndex = util.makeMap(leader.peers, 1);
  leader.nextIndex = util.makeMap(leader.peers, 2);
  leader.rpcDue = util.makeMap(leader.peers, util.Inf);
  leader.heartbeatDue = util.makeMap(leader.peers, util.Inf);
  follower.electionAlarm = 444444;

  model.messages.push({
    from: leader.id,
    to: follower.id,
    type: 'AppendEntries',
    direction: 'request',
    term: leader.term,
    prevIndex: 1,
    prevTerm: 3,
    entries: [],
    commitIndex: 0,
    sendTime: model.time,
    recvTime: model.time + 1000
  });

  raft.networkFailure(model, leader);
  model.time += 1000;
  raft.update(model);

  assert(
    follower.electionAlarm === 444444,
    'networkFailure should drop queued AppendEntries from the failed leader before they reset follower electionAlarm'
  );
  assert(
    model.messages.length === 0,
    'networkFailure should remove in-flight messages that belong to the failed server'
  );
}

function testHeartbeatDeliveredAtElectionDeadlinePreventsSpuriousElection() {
  const harness = createRaftHarness(31);
  const raft = harness.raft;
  const util = harness.util;
  const model = harness.model;
  const leader = model.servers[0];
  const follower = model.servers[2];

  leader.state = 'leader';
  leader.term = 4;
  leader.votedFor = 1;
  leader.log = [{ term: 4, value: 'v' }];
  leader.matchIndex = util.makeMap(leader.peers, 1);
  leader.nextIndex = util.makeMap(leader.peers, 2);
  leader.rpcDue = util.makeMap(leader.peers, util.Inf);
  leader.heartbeatDue = util.makeMap(leader.peers, util.Inf);

  follower.state = 'follower';
  follower.term = 4;
  follower.votedFor = null;
  follower.electionAlarm = 1000;

  model.messages.push({
    from: leader.id,
    to: follower.id,
    type: 'AppendEntries',
    direction: 'request',
    term: leader.term,
    prevIndex: 1,
    prevTerm: 4,
    entries: [],
    commitIndex: 0,
    sendTime: model.time,
    recvTime: 1000
  });

  model.time = 1000;
  raft.update(model);

  assert(
    follower.state === 'follower',
    'a heartbeat that arrives exactly at election timeout should be processed before the follower starts a new election'
  );
  assert(
    follower.term === 4,
    'a heartbeat that arrives exactly at election timeout should not force the follower to bump its term'
  );
  assert(
    follower.electionAlarm > model.time,
    'a heartbeat that arrives exactly at election timeout should reset the follower electionAlarm'
  );
}

function testHeartbeatReplyKeepsHeartbeatVisualType() {
  const harness = createRaftHarness(37);
  const raft = harness.raft;
  const util = harness.util;
  const model = harness.model;
  const leader = model.servers[0];

  leader.state = 'leader';
  leader.term = 4;
  leader.votedFor = 1;
  leader.log = [{ term: 4, value: 'v' }];
  leader.matchIndex = util.makeMap(leader.peers, 1);
  leader.nextIndex = util.makeMap(leader.peers, 2);
  leader.rpcDue = util.makeMap(leader.peers, util.Inf);
  leader.heartbeatDue = util.makeMap(leader.peers, util.Inf);

  model.messages.push({
    from: 1,
    to: 3,
    type: 'AppendEntries',
    direction: 'request',
    term: 4,
    prevIndex: 1,
    prevTerm: 4,
    entries: [],
    commitIndex: 0,
    visualType: 'Heartbeat',
    sendTime: model.time,
    recvTime: model.time + 1000
  });

  model.time += 1000;
  raft.update(model);

  const reply = model.messages.filter(function(message) {
    return message.type === 'AppendEntries' &&
      message.direction === 'reply' &&
      message.from === 3 &&
      message.to === 1;
  })[0];

  assert(
    reply && reply.visualType === 'Heartbeat',
    'heartbeat replies should preserve the heartbeat visual type instead of falling back to AppendEntries'
  );
}

function testConflictSceneRecoversServer1AsLeader() {
  const result = runUntilSceneStep({
    seed: 5,
    sceneId: 'conflict-log-overwrite',
    targetStepIndex: 6,
    leaderId: 1,
    tickDuration: 10000,
    maxTicks: 3000
  });

  assert(
    result.servers[0].state === 'leader',
    'conflict-log-overwrite step 6 should hand leadership back to Server 1 before step 7 starts'
  );
  assert(
    result.servers[1].state !== 'leader',
    'conflict-log-overwrite step 6 should not allow Server 2 to win the election'
  );
}

function testConflictSceneAdvancesToFinalOverwritePhase() {
  const result = runUntilSceneStep({
    seed: 5,
    sceneId: 'conflict-log-overwrite',
    targetStepIndex: 8,
    leaderId: 5,
    tickDuration: 10000,
    maxTicks: 5000
  });

  assert(
    result.servers[4].state === 'leader',
    'conflict-log-overwrite should reach the final overwrite phase with Server 5 as leader'
  );
}

function testConflictScenePartiallySyncsServer3BeforeLeaderSwitchBack() {
  const result = runUntilSceneStep({
    seed: 5,
    sceneId: 'conflict-log-overwrite',
    targetStepIndex: 7,
    leaderId: 1,
    tickDuration: 10000,
    maxTicks: 4000
  });

  assert(
    result.servers[0].log.length === 3,
    'conflict-log-overwrite step 7 should keep the old leader branch extended on Server 1 before the next switch'
  );
  assert(
    result.servers[2].log.length === 2,
    'conflict-log-overwrite step 7 should propagate the old branch to Server 3 before the next leader switch'
  );
}

function testConflictSceneKeepsServer3TrafficReadable() {
  const appendEntriesCount = countSceneMessages({
    seed: 5,
    sceneId: 'conflict-log-overwrite',
    startStepIndex: 6,
    stopStepIndex: 7,
    tickDuration: 10000,
    maxTicks: 4000,
    filter: function(message) {
      return message.type === 'AppendEntries' &&
        message.direction === 'request' &&
        message.from === 1 &&
        message.to === 3;
    }
  });

  assert(
    appendEntriesCount === 2,
    'conflict-log-overwrite step 7 should show exactly two Server 1 -> Server 3 AppendEntries rounds in the demo'
  );
}

function testConflictSceneShowsOnlyOneServer3RequestAtStep7Start() {
  const result = runUntilSceneStep({
    seed: 5,
    sceneId: 'conflict-log-overwrite',
    targetStepIndex: 6,
    leaderId: 1,
    tickDuration: 10000,
    maxTicks: 4000
  });

  const server3Requests = result.messages.filter(function(message) {
    return message.type === 'AppendEntries' &&
      message.direction === 'request' &&
      message.from === 1 &&
      message.to === 3;
  });

  assert(
    server3Requests.length === 1,
    'conflict-log-overwrite step 7 should start with exactly one visible AppendEntries from Server 1 to Server 3'
  );
}

function testConflictSceneKeepsOnlyOneVisibleCopyForServer2InStep3() {
  const appendEntriesCount = countSceneMessages({
    seed: 5,
    sceneId: 'conflict-log-overwrite',
    startStepIndex: 2,
    stopStepIndex: 3,
    tickDuration: 10000,
    maxTicks: 2000,
    filter: function(message) {
      return message.type === 'AppendEntries' &&
        message.direction === 'request' &&
        message.from === 1;
    }
  });

  assert(
    appendEntriesCount === 1,
    'conflict-log-overwrite step 3 should keep only one visible AppendEntries copy from Server 1 so the demo clearly shows that only Server 2 received it'
  );
}

function testConflictSceneHidesEmptyHeartbeatsInStep5() {
  const appendEntriesCount = countSceneMessages({
    seed: 5,
    sceneId: 'conflict-log-overwrite',
    startStepIndex: 4,
    stopStepIndex: 5,
    tickDuration: 10000,
    maxTicks: 2000,
    filter: function(message) {
      return message.type === 'AppendEntries' &&
        message.direction === 'request' &&
        message.from === 5;
    }
  });

  assert(
    appendEntriesCount === 0,
    'conflict-log-overwrite step 5 should not show empty heartbeats from Server 5 because they distract from the local unreplicated write'
  );
}

[
  testRecoverySceneWaitsForFirstRequestToDrain,
  testRecoverySceneWaitsForSecondRequestToDrainBeforeCrash,
  testDemoControllerCanSerializeAndRestore,
  testNetworkFailureDropsInflightAppendEntries,
  testHeartbeatDeliveredAtElectionDeadlinePreventsSpuriousElection,
  testHeartbeatReplyKeepsHeartbeatVisualType,
  testConflictSceneKeepsOnlyOneVisibleCopyForServer2InStep3,
  testConflictSceneHidesEmptyHeartbeatsInStep5,
  testConflictSceneRecoversServer1AsLeader,
  testConflictScenePartiallySyncsServer3BeforeLeaderSwitchBack,
  testConflictSceneShowsOnlyOneServer3RequestAtStep7Start,
  testConflictSceneKeepsServer3TrafficReadable,
  testConflictSceneAdvancesToFinalOverwritePhase
].forEach(function(testCase) {
  testCase();
});

console.log('demo scene regressions: PASS');
