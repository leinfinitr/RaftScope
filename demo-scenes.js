(function(global) {
  'use strict';

  var majorityCount = function(total) {
    return Math.floor(total / 2) + 1;
  };

  var countReplicatedAtLeast = function(model, leaderId, minLogLength) {
    var replicated = 1;
    model.servers.forEach(function(server) {
      if (server.id !== leaderId && server.log.length >= minLogLength) {
        replicated += 1;
      }
    });
    return replicated;
  };

  var countAvailableMatchingLeader = function(model, leader, followerIds) {
    var replicated = 1;
    followerIds.forEach(function(id) {
      var server = model.servers[id - 1];
      if (server &&
          server.state !== 'stopped' &&
          server.log.length === leader.log.length) {
        replicated += 1;
      }
    });
    return replicated;
  };

  var allAvailableServersHaveLogLengthAtLeast = function(model, minLogLength) {
    return model.servers.every(function(server) {
      return server.state === 'stopped' || server.log.length >= minLogLength;
    });
  };

  var allAvailableFollowersAckLengthAtLeast = function(model, leader, minLogLength) {
    if (!leader) {
      return false;
    }
    return leader.peers.every(function(peerId) {
      var peer = model.servers[peerId - 1];
      return !peer ||
        peer.state === 'stopped' ||
        leader.matchIndex[peerId] >= minLogLength;
    });
  };

  var prepareRecoveredServerForNextLeadership = function(model, server) {
    var maxTerm = 0;
    model.servers.forEach(function(otherServer) {
      if (otherServer.state !== 'stopped') {
        maxTerm = Math.max(maxTerm, otherServer.term);
      }
    });
    server.term = Math.max(server.term, maxTerm);
    server.votedFor = null;
  };

  var hasPendingAppendEntriesTraffic = function(model, firstId, secondId) {
    return model.messages.some(function(message) {
      return message.type === 'AppendEntries' &&
        ((message.from === firstId && message.to === secondId) ||
         (message.from === secondId && message.to === firstId));
    });
  };

  var suspendAutomaticReplicationToPeer = function(leader, peerId, inf) {
    leader.rpcDue[peerId] = inf;
    leader.heartbeatDue[peerId] = inf;
  };

  var sendControlledAppendEntriesToPeer = function(ctx, leader, peerId) {
    ctx.rules().sendAppendEntriesToSome(ctx.model(), leader, peerId);
    suspendAutomaticReplicationToPeer(leader, peerId, ctx.constants().INF);
  };

  var scenes = [{
    id: 'failure-recovery-log-catchup',
    title: '故障恢复与日志追平',
    steps: [{
      title: '等待 Server 1 成为 Leader',
      description: '从五个空节点开始，让 Server 1 最先超时发起选举。',
      pauseMessage: 'Server 1 已成为 Leader，可以先介绍五个节点的初始状态和选举结果。',
      minimumElapsed: 50000,
      action: function(ctx) {
        var model = ctx.model();
        ctx.resetCluster();
        model = ctx.model();
        ctx.log('步骤1: 等待Server 1成为leader...');
        model.servers.forEach(function(server) {
          if (server.id !== 1) {
            server.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT * 2;
          }
        });
        model.servers[0].electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT;
      },
      check: function(ctx) {
        var server1 = ctx.server(1);
        return server1 &&
          server1.state === 'leader' &&
          ctx.countTrue(ctx.mapValues(server1.voteGranted)) + 1 > Math.floor(ctx.constants().NUM_SERVERS / 2);
      }
    }, {
      title: '提交第一个请求',
      description: '向 Server 1 发送第一个客户端请求，并等待多数节点复制。',
      pauseMessage: '第一条日志已经复制到多数节点，可以讲解日志复制和提交条件。',
      minimumElapsed: 50000,
      action: function(ctx) {
        var server1 = ctx.server(1);
        ctx.log('步骤2: 向Server 1发送第一个请求...');
        ctx.clientRequest(1);
        ctx._recoveryLeaderId = server1 ? server1.id : 1;
      },
      check: function(ctx) {
        var model = ctx.model();
        var server1 = ctx.server(1);
        if (!server1 || server1.log.length !== 1) {
          return false;
        }
        return countReplicatedAtLeast(model, server1.id, 1) > Math.floor(ctx.constants().NUM_SERVERS / 2) &&
          allAvailableServersHaveLogLengthAtLeast(model, 1) &&
          allAvailableFollowersAckLengthAtLeast(model, server1, 1);
      }
    }, {
      title: '提交第二个请求',
      description: '继续向 Server 1 发送第二个请求，并等待多数节点复制。',
      pauseMessage: '第二条日志已复制完成，可以继续讲解日志增长过程。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤3: 向Server 1发送第二个请求...');
        ctx.clientRequest(1);
      },
      check: function(ctx) {
        var model = ctx.model();
        var server1 = ctx.server(1);
        if (!server1 || server1.log.length !== 2) {
          return false;
        }
        return countReplicatedAtLeast(model, server1.id, 2) > Math.floor(ctx.constants().NUM_SERVERS / 2) &&
          allAvailableServersHaveLogLengthAtLeast(model, 2) &&
          allAvailableFollowersAckLengthAtLeast(model, server1, 2);
      }
    }, {
      title: 'Leader 宕机并触发重新选举',
      description: '让 Server 1 宕机，并安排 Server 2 在剩余节点中成为新的 Leader。',
      pauseMessage: 'Leader 故障后，Server 2 已接管，可以讲解重新选举。',
      minimumElapsed: 50000,
      action: function(ctx) {
        var model = ctx.model();
        var server1 = ctx.server(1);
        var server2 = ctx.server(2);
        ctx.log('步骤4: Server 1宕机..., Server 2成为leader...');
        ctx.networkFail(1);
        model.servers.forEach(function(server) {
          if (server.id !== 2) {
            server.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT * 2;
          }
        });
        server2.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT;
      },
      check: function(ctx) {
        return ctx.server(1).state === 'stopped' && ctx.server(2).state === 'leader';
      }
    }, {
      title: '向已宕机 Leader 发送请求',
      description: '尝试向已宕机的 Server 1 发送请求，观察其不会产生效果。',
      pauseMessage: '对已宕机节点的请求不会生效，可以说明客户端应寻找当前 Leader。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤5: 尝试向已宕机的Server 1发送请求...');
        ctx.clientRequest(1);
      },
      check: function() {
        return true;
      }
    }, {
      title: '进一步制造网络故障',
      description: '让 Server 4 和 Server 5 同时故障，缩小可用节点集合。',
      pauseMessage: '此时集群可用节点进一步减少，可以说明多数派的重要性。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤6: Server 4和5网络故障...');
        ctx.networkFail(4);
        ctx.networkFail(5);
      },
      check: function(ctx) {
        return ctx.server(4).state === 'stopped' && ctx.server(5).state === 'stopped';
      }
    }, {
      title: '在仅剩两个可用节点时尝试写入',
      description: '在只有 Server 2 和 Server 3 可用时继续向 Server 2 发送请求。',
      pauseMessage: '请求已发出，但此时没有稳定多数派，可以讲解为什么日志无法可靠提交。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤7: 在只有2个节点可用时向Server 2发送请求...');
        ctx.clientRequest(2);
      },
      check: function() {
        return true;
      }
    }, {
      title: '让旧多数派彻底失效',
      description: '继续让 Server 2 和 Server 3 故障，集群进入更极端的恢复场景。',
      pauseMessage: '现在原有多数派已经失效，可以进入恢复阶段。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤8: Server 2和3网络故障...');
        ctx.networkFail(2);
        ctx.networkFail(3);
      },
      check: function(ctx) {
        return ctx.server(2).state === 'stopped' && ctx.server(3).state === 'stopped';
      }
    }, {
      title: '恢复 Server 1、4、5',
      description: '恢复 Server 1、4、5，并安排 Server 5 最先超时以便重新建立多数派。',
      pauseMessage: '恢复节点后，集群重新具备形成多数派的条件。',
      minimumElapsed: 50000,
      action: function(ctx) {
        var model = ctx.model();
        var server5 = ctx.server(5);
        ctx.log('步骤9: 恢复Server 1、4和5...');
        ctx.networkRecover(1);
        ctx.networkRecover(4);
        ctx.networkRecover(5);
        model.servers.forEach(function(server) {
          if (server.id !== 5 && server.state !== 'stopped') {
            server.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT * 2;
          }
        });
        server5.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT;
      },
      check: function(ctx) {
        return ctx.server(2).state === 'stopped' &&
          ctx.server(3).state === 'stopped' &&
          ctx.server(1).state !== 'stopped' &&
          ctx.server(4).state !== 'stopped' &&
          ctx.server(5).state !== 'stopped';
      }
    }, {
      title: '等待 Server 5 成为 Leader',
      description: '等待恢复后的 Server 5 通过新一轮选举成为 Leader。',
      pauseMessage: 'Server 5 已经接任 Leader，可以讲解恢复后的重新选举。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤10: 等待Server 5成为leader...');
      },
      check: function(ctx) {
        var server5 = ctx.server(5);
        return server5 &&
          server5.state === 'leader' &&
          ctx.countTrue(ctx.mapValues(server5.voteGranted)) + 1 > Math.floor(ctx.constants().NUM_SERVERS / 2);
      }
    }, {
      title: '由新 Leader 追加新日志',
      description: '向 Server 5 发送一个新的客户端请求，并等待当前可用节点追平。',
      pauseMessage: '新 Leader 的日志已在当前可用节点之间传播，可以讲解新的提交路径。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤11: 向Server 5发送新请求...');
        ctx.clientRequest(5);
      },
      check: function(ctx) {
        var model = ctx.model();
        var server5 = ctx.server(5);
        var replicatedCount;
        if (!server5 || server5.log.length <= 2) {
          return false;
        }
        replicatedCount = countAvailableMatchingLeader(model, server5, [1, 4]);
        return replicatedCount >= 2;
      }
    }, {
      title: '恢复剩余节点并完成日志追平',
      description: '恢复 Server 2 和 Server 3，观察它们最终追上当前 Leader 的日志。',
      pauseMessage: '所有节点已经重新追平，可以总结故障恢复与日志追平的完整流程。',
      minimumElapsed: 50000,
      action: function(ctx) {
        ctx.log('步骤12: Server 2和3网络恢复...');
        ctx.networkRecover(2);
        ctx.networkRecover(3);
      },
      check: function(ctx) {
        var server5 = ctx.server(5);
        return ctx.server(2).state !== 'stopped' &&
          ctx.server(3).state !== 'stopped' &&
          ctx.server(2).log.length === server5.log.length &&
          ctx.server(3).log.length === server5.log.length;
      }
    }]
  }, {
    id: 'conflict-log-overwrite',
    title: '冲突日志覆盖演示',
    steps: [{
      title: '建立初始 Leader',
      description: '从五个空节点开始，让 Server 1 成为第一任 Leader。',
      pauseMessage: 'Server 1 已成为初始 Leader，可以先说明演示即将构造冲突日志。',
      minimumElapsed: 100000,
      action: function(ctx) {
        var model = ctx.model();
        ctx.resetCluster();
        model = ctx.model();
        ctx.log('步骤1: 初始Leader为Server 1');
        model.servers.forEach(function(server) {
          if (server.id !== 1) {
            server.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT * 2;
          }
        });
        ctx.timeout(1);
        ctx.server(1).electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT;
      },
      check: function(ctx) {
        var server1 = ctx.server(1);
        return server1 &&
          server1.state === 'leader' &&
          ctx.countTrue(ctx.mapValues(server1.voteGranted)) + 1 > Math.floor(ctx.constants().NUM_SERVERS / 2);
      }
    }, {
      title: '提交第一条稳定日志',
      description: '向 Server 1 发送请求，并等待它被提交到多数节点。',
      pauseMessage: '第一条稳定日志已经提交，后续所有冲突都会以它为参照。',
      minimumElapsed: 100000,
      action: function(ctx) {
        ctx.log('步骤2: 向Server 1发送请求，并等待其提交');
        ctx.clientRequest(1);
      },
      check: function(ctx) {
        var model = ctx.model();
        var server1 = ctx.server(1);
        if (!server1 || server1.log.length !== 1) {
          return false;
        }
        return countReplicatedAtLeast(model, server1.id, 1) > Math.floor(ctx.constants().NUM_SERVERS / 2) &&
          allAvailableServersHaveLogLengthAtLeast(model, 1) &&
          allAvailableFollowersAckLengthAtLeast(model, server1, 1);
      }
    }, {
      title: '构造只部分复制的未提交日志',
      description: '再次发起请求，并只把新的 AppendEntries 发送给 Server 2，制造冲突后缀。',
      pauseMessage: '只有 Server 2 收到了额外日志，这就是后续要被覆盖的冲突后缀。',
      minimumElapsed: 100000,
      action: function(ctx) {
        var model = ctx.model();
        var server1 = ctx.server(1);
        var rules = ctx.rules();
        ctx.log('步骤3: 再次发起请求');
        ctx.clientRequest(1);
        ctx.log('步骤3: 网络故障! 只有Server 2收到了AppendEntry');
        ctx.setAppendEntriesEnabled(false);
        rules.sendAppendEntriesToSome(model, server1, 2);
        rules.sendAppendEntriesToSome(model, server1, 2);
      },
      check: function(ctx) {
        return ctx.server(2).log.length === 2;
      }
    }, {
      title: 'Server 1 故障，Server 5 成为 Leader',
      description: '让 Server 1 故障，并安排 Server 5 成为新的 Leader。',
      pauseMessage: 'Leader 已切换到 Server 5，可以观察任期和投票变化。',
      minimumElapsed: 100000,
      action: function(ctx) {
        var model = ctx.model();
        var server5 = ctx.server(5);
        ctx.log('步骤4: Server 1网络故障, Server 5成为Leader');
        ctx.networkFail(1);
        model.servers.forEach(function(server) {
          if (server.id !== 5) {
            server.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT * 2;
          }
        });
        server5.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT;
      },
      check: function(ctx) {
        var server5 = ctx.server(5);
        return server5 &&
          server5.state === 'leader' &&
          ctx.countTrue(ctx.mapValues(server5.voteGranted)) + 1 > Math.floor(ctx.constants().NUM_SERVERS / 2);
      }
    }, {
      title: '由 Server 5 追加新日志',
      description: '向新的 Leader Server 5 发送请求，但暂不让它完成日志同步。',
      pauseMessage: 'Server 5 已经写入自己的新日志，但冲突尚未被消除。',
      minimumElapsed: 100000,
      action: function(ctx) {
        ctx.log('步骤5: 向Server 5发送新请求');
        ctx.clientRequest(5);
        ctx.log('步骤5: 但Server 5还没AppendEntry');
      },
      check: function(ctx) {
        return ctx.server(5).log.length === 2;
      }
    }, {
      title: 'Server 5 故障，Server 1 恢复并重新成为 Leader',
      description: '恢复 Server 1、故障 Server 5，并让 Server 1 重新成为 Leader。',
      pauseMessage: 'Server 1 重新获得领导权，接下来会继续扩展旧日志分支。',
      minimumElapsed: 100000,
      action: function(ctx) {
        var model = ctx.model();
        var server1 = ctx.server(1);
        ctx.log('步骤6: Server 5网络故障, Server 1网络恢复成为Leader');
        ctx.networkRecover(1);
        prepareRecoveredServerForNextLeadership(model, server1);
        ctx.networkFail(5);
        server1.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT;
        model.servers.forEach(function(server) {
          if (server.id !== 1) {
            server.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT * 2;
          }
        });
      },
      check: function(ctx) {
        return ctx.server(1).state === 'leader';
      }
    }, {
      title: 'Server 1 扩展旧日志并部分传播',
      description: 'Server 1 再写入一条日志，只向 Server 3 传播部分旧条目。',
      pauseMessage: '旧 Leader 分支上的日志被继续扩展，但只传播到了部分节点。',
      minimumElapsed: 100000,
      action: function(ctx) {
        var server1 = ctx.server(1);
        ctx.log('步骤7: 向Server 1发送新请求');
        ctx.clientRequest(1);
        server1.matchIndex[3] = 1;
        server1.nextIndex[3] = 2;
        sendControlledAppendEntriesToPeer(ctx, server1, 3);
        ctx._ruleStep7ManualRetryCount = 0;
        ctx.log('步骤7: Server 1 Append了部分旧Entry');
      },
      check: function(ctx) {
        var server1 = ctx.server(1);
        var server3 = ctx.server(3);
        suspendAutomaticReplicationToPeer(server1, 3, ctx.constants().INF);
        if (server3.log.length < 2 && server1.state === 'leader') {
          if (!hasPendingAppendEntriesTraffic(ctx.model(), server1.id, server3.id)) {
            sendControlledAppendEntriesToPeer(ctx, server1, 3);
            ctx._ruleStep7ManualRetryCount += 1;
          }
          return false;
        }
        return server1.log.length === 3 && server3.log.length === 2;
      }
    }, {
      title: 'Server 1 故障，Server 5 再次成为 Leader',
      description: '在旧分支还未完全同步时，让 Server 1 故障并恢复 Server 5 的领导权。',
      pauseMessage: 'Server 5 再次成为 Leader，冲突覆盖即将发生。',
      minimumElapsed: 100000,
      action: function(ctx) {
        var model = ctx.model();
        var server5 = ctx.server(5);
        ctx.log('步骤8: Server 1同步Entry时网络故障');
        ctx.log('步骤8: Server 5成为Leader');
        ctx.networkRecover(5);
        prepareRecoveredServerForNextLeadership(model, server5);
        ctx.networkFail(1);
        server5.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT;
        model.servers.forEach(function(server) {
          if (server.id !== 5) {
            server.electionAlarm = model.time + ctx.constants().ELECTION_TIMEOUT * 2;
          }
        });
      },
      check: function(ctx) {
        return ctx.server(5).state === 'leader';
      }
    }, {
      title: '新 Leader 覆盖冲突后缀',
      description: '恢复 Server 1，重新开启 AppendEntries，并让 Server 5 把自己的日志同步到所有节点。',
      pauseMessage: '冲突后缀已经被新 Leader 的日志覆盖，可以总结 Raft 的日志匹配规则。',
      minimumElapsed: 100000,
      action: function(ctx) {
        ctx.log('步骤9: 向Server 5发送新请求并Append到Follower');
        ctx.networkRecover(1);
        ctx.setAppendEntriesEnabled(true);
        ctx.clientRequest(5);
      },
      check: function(ctx) {
        var model = ctx.model();
        var server5 = ctx.server(5);
        var replicatedCount = 1;
        model.servers.forEach(function(server) {
          if (server.id !== server5.id && server.log.length === server5.log.length) {
            replicatedCount += 1;
          }
        });
        return server5.log.length === 3 && replicatedCount === ctx.constants().NUM_SERVERS;
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
