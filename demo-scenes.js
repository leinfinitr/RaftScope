(function(global) {
  'use strict';

  var majorityCount = function(total) {
    return Math.floor(total / 2) + 1;
  };

  var countReplicated = function(model, minLogLength) {
    var replicated = 0;
    model.servers.forEach(function(server) {
      if (server.state !== 'stopped' && server.log.length >= minLogLength) {
        replicated += 1;
      }
    });
    return replicated;
  };

  var scenes = [{
    id: 'failure-recovery-log-catchup',
    title: '故障恢复与日志追平',
    steps: [{
      title: '建立 Leader 并写入首条日志',
      description: '重置集群，指定 Server 1 为 Leader，然后追加一条日志。',
      pauseMessage: '首条日志写入并复制后暂停，准备制造故障。',
      action: function(ctx) {
        ctx.resetCluster();
        ctx.forceLeader(1);
        ctx.clientRequest(1);
      },
      check: function(ctx) {
        var model = ctx.model();
        var leader = ctx.server(1);
        if (!leader || leader.state !== 'leader' || leader.log.length < 1) {
          return false;
        }
        return countReplicated(model, 1) >= majorityCount(model.servers.length);
      }
    }, {
      title: '故障节点恢复并追平日志',
      description: '让 Server 4、5 先故障再恢复，观察其日志追平当前 Leader。',
      pauseMessage: '恢复节点完成日志追平后暂停。',
      action: function(ctx) {
        ctx.networkFail(4);
        ctx.networkFail(5);
        ctx.clientRequest(1);
        ctx._failureRecoveryStep = {
          recoveryDelayTicks: 1,
          recoveryTriggered: false
        };
      },
      check: function(ctx) {
        var leader = ctx.server(1);
        var s4 = ctx.server(4);
        var s5 = ctx.server(5);
        var flow = ctx._failureRecoveryStep || {
          recoveryDelayTicks: 1,
          recoveryTriggered: false
        };
        ctx._failureRecoveryStep = flow;

        if (!leader || leader.state !== 'leader' || leader.log.length < 2) {
          return false;
        }

        if (!flow.recoveryTriggered) {
          if (flow.recoveryDelayTicks > 0) {
            flow.recoveryDelayTicks -= 1;
            return false;
          }
          if (!s4 || !s5 || s4.state !== 'stopped' || s5.state !== 'stopped') {
            return false;
          }
          ctx.networkRecover(4);
          ctx.networkRecover(5);
          flow.recoveryTriggered = true;
          return false;
        }

        if (!s4 || !s5 || s4.state === 'stopped' || s5.state === 'stopped') {
          return false;
        }
        return s4.log.length === leader.log.length &&
               s5.log.length === leader.log.length;
      }
    }]
  }, {
    id: 'conflict-log-overwrite',
    title: '冲突日志覆盖演示',
    steps: [{
      title: '构造冲突日志',
      description: '先写入基础日志，再人为制造 Server 2 的冲突后缀。',
      pauseMessage: '冲突日志已构造，暂停观察差异。',
      action: function(ctx) {
        ctx.resetCluster();
        ctx.forceLeader(1);
        ctx.clientRequest(1);
        ctx.networkFail(2);
        ctx.clientRequest(1);

        var leader = ctx.server(1);
        var follower = ctx.server(2);
        if (leader && follower && leader.log.length >= 2) {
          follower.log = leader.log.slice(0, 1).concat([{
            term: leader.term + 1,
            value: 'conflict'
          }]);
          follower.commitIndex = Math.min(follower.commitIndex, 1);
        }
      },
      check: function(ctx) {
        var leader = ctx.server(1);
        var follower = ctx.server(2);
        if (!leader || !follower || leader.log.length < 2 || follower.log.length < 2) {
          return false;
        }
        if (follower.state !== 'stopped') {
          return false;
        }
        return follower.log[1].term !== leader.log[1].term;
      }
    }, {
      title: '新 Leader 覆盖冲突后缀',
      description: '切换 Leader 到 Server 5，并通过新日志覆盖冲突条目。',
      pauseMessage: '冲突条目被覆盖后暂停。',
      action: function(ctx) {
        ctx.networkFail(1);
        ctx.forceLeader(5);
        ctx.clientRequest(5);
        ctx._conflictRecoveryStep = {
          recoveryDelayTicks: 1,
          recoveryTriggered: false
        };
      },
      check: function(ctx) {
        var leader = ctx.server(5);
        var follower = ctx.server(2);
        var server1 = ctx.server(1);
        var flow = ctx._conflictRecoveryStep || {
          recoveryDelayTicks: 1,
          recoveryTriggered: false
        };
        ctx._conflictRecoveryStep = flow;

        if (!leader || !follower || leader.state !== 'leader') {
          return false;
        }

        if (!flow.recoveryTriggered) {
          if (flow.recoveryDelayTicks > 0) {
            flow.recoveryDelayTicks -= 1;
            return false;
          }
          if (follower.state === 'stopped') {
            ctx.networkRecover(2);
          }
          if (server1 && server1.state === 'stopped') {
            ctx.networkRecover(1);
          }
          flow.recoveryTriggered = true;
          return false;
        }

        if (leader.log.length < 2 || follower.log.length !== leader.log.length) {
          return false;
        }
        if (follower.state === 'stopped') {
          return false;
        }
        return follower.log[1].term === leader.log[1].term;
      }
    }]
  }];

  var cloneScene = function(scene) {
    var copy = Object.assign({}, scene);
    copy.steps = scene.steps.map(function(step) {
      return Object.assign({}, step);
    });
    return copy;
  };

  global.demoScenes = {
    getAll: function() {
      return scenes.map(cloneScene);
    }
  };
})(window);
