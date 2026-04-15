/* jshint globalstrict: true */
/* jshint browser: true */
/* jshint devel: true */
/* jshint jquery: true */
/* global util */
'use strict';

var raft = {};
var RPC_TIMEOUT = 50000;
var MIN_RPC_LATENCY = 10000;
var MAX_RPC_LATENCY = 15000;
var ELECTION_TIMEOUT = 100000;
var NUM_SERVERS = 5;
var BATCH_SIZE = 1;
raft.enableAppendEntries = true;  // 添加控制变量

(function() {

var sendMessage = function(model, message) {
  message.sendTime = model.time;
  message.recvTime = model.time +
                     MIN_RPC_LATENCY +
                     Math.random() * (MAX_RPC_LATENCY - MIN_RPC_LATENCY);
  model.messages.push(message);
};

var sendRequest = function(model, request) {
  request.direction = 'request';
  sendMessage(model, request);
};

var sendReply = function(model, request, reply) {
  reply.from = request.to;
  reply.to = request.from;
  reply.type = request.type;
  reply.direction = 'reply';
  sendMessage(model, reply);
};

var dropMessagesForServer = function(model, serverId) {
  model.messages = model.messages.filter(function(message) {
    return message.from != serverId && message.to != serverId;
  });
};

var logTerm = function(log, index) {
  if (index < 1 || index > log.length) {
    return 0;
  } else {
    return log[index - 1].term;
  }
};

var rules = {};
raft.rules = rules;

var makeElectionAlarm = function(now) {
  return now + (Math.random() + 1) * ELECTION_TIMEOUT;
};

// 将函数暴露到raft对象上
raft.makeElectionAlarm = makeElectionAlarm;

raft.server = function(id, peers) {
  return {
    id: id,
    peers: peers,
    state: 'follower',
    term: 1,
    votedFor: null,
    log: [],
    commitIndex: 0,
    electionAlarm: makeElectionAlarm(0),
    voteGranted:  util.makeMap(peers, false),
    matchIndex:   util.makeMap(peers, 0),
    nextIndex:    util.makeMap(peers, 1),
    rpcDue:       util.makeMap(peers, 0),
    heartbeatDue: util.makeMap(peers, 0),
  };
};

var stepDown = function(model, server, term) {
  server.term = term;
  server.state = 'follower';
  server.votedFor = null;
  if (server.electionAlarm <= model.time || server.electionAlarm == util.Inf) {
    server.electionAlarm = makeElectionAlarm(model.time);
  }
};

rules.startNewElection = function(model, server) {
  if ((server.state == 'follower' || server.state == 'candidate') &&
      server.electionAlarm <= model.time) {
    server.electionAlarm = makeElectionAlarm(model.time);
    server.term += 1;
    server.votedFor = server.id;
    server.state = 'candidate';
    server.voteGranted  = util.makeMap(server.peers, false);
    server.matchIndex   = util.makeMap(server.peers, 0);
    server.nextIndex    = util.makeMap(server.peers, 1);
    server.rpcDue       = util.makeMap(server.peers, 0);
    server.heartbeatDue = util.makeMap(server.peers, 0);
  }
};

rules.sendRequestVote = function(model, server, peer) {
  if (server.state == 'candidate' &&
      server.rpcDue[peer] <= model.time) {
    server.rpcDue[peer] = model.time + RPC_TIMEOUT;
    sendRequest(model, {
      from: server.id,
      to: peer,
      type: 'RequestVote',
      term: server.term,
      lastLogTerm: logTerm(server.log, server.log.length),
      lastLogIndex: server.log.length});
  }
};

rules.becomeLeader = function(model, server) {
  if (server.state == 'candidate' &&
      util.countTrue(util.mapValues(server.voteGranted)) + 1 > Math.floor(NUM_SERVERS / 2)) {
    //console.log('server ' + server.id + ' is leader in term ' + server.term);
    server.state = 'leader';
    server.nextIndex    = util.makeMap(server.peers, server.log.length + 1);
    server.rpcDue       = util.makeMap(server.peers, util.Inf);
    server.heartbeatDue = util.makeMap(server.peers, 0);
    server.electionAlarm = util.Inf;
  }
};

rules.sendAppendEntries = function(model, server, peer) {
  if (server.state == 'leader' &&
      (server.heartbeatDue[peer] <= model.time ||
       (raft.enableAppendEntries && server.nextIndex[peer] <= server.log.length &&
        server.rpcDue[peer] <= model.time))) {
    var prevIndex = server.nextIndex[peer] - 1;
    var lastIndex = Math.min(prevIndex + BATCH_SIZE,
                             server.log.length);
    if (server.matchIndex[peer] + 1 < server.nextIndex[peer])
      lastIndex = prevIndex;
    sendRequest(model, {
      from: server.id,
      to: peer,
      type: 'AppendEntries',
      term: server.term,
      prevIndex: prevIndex,
      prevTerm: logTerm(server.log, prevIndex),
      entries: raft.enableAppendEntries ? server.log.slice(prevIndex, lastIndex) : [],
      commitIndex: Math.min(server.commitIndex, lastIndex)});
    server.rpcDue[peer] = model.time + RPC_TIMEOUT;
    server.heartbeatDue[peer] = model.time + ELECTION_TIMEOUT / 2;
  }
};

rules.sendAppendEntriesToSome = function(model, server, peer) {
  if (server.state == 'leader') {
    var prevIndex = server.nextIndex[peer] - 1;
    var lastIndex = Math.min(prevIndex + BATCH_SIZE,
                             server.log.length);
    if (server.matchIndex[peer] + 1 < server.nextIndex[peer])
      lastIndex = prevIndex;
    sendRequest(model, {
      from: server.id,
      to: peer,
      type: 'AppendEntries',
      term: server.term,
      prevIndex: prevIndex,
      prevTerm: logTerm(server.log, prevIndex),
      entries: server.log.slice(prevIndex, lastIndex),
      commitIndex: Math.min(server.commitIndex, lastIndex)});
    server.rpcDue[peer] = model.time + RPC_TIMEOUT;
    server.heartbeatDue[peer] = model.time + ELECTION_TIMEOUT / 2;
  }
};

rules.advanceCommitIndex = function(model, server) {
  var matchIndexes = util.mapValues(server.matchIndex).concat(server.log.length);
  matchIndexes.sort(util.numericCompare);
  var n = matchIndexes[Math.floor(NUM_SERVERS / 2)];
  if (server.state == 'leader' &&
      logTerm(server.log, n) == server.term) {
    server.commitIndex = Math.max(server.commitIndex, n);
  }
};

var handleRequestVoteRequest = function(model, server, request) {
  if (server.term < request.term)
    stepDown(model, server, request.term);
  var granted = false;
  if (server.term == request.term &&
      (server.votedFor === null ||
       server.votedFor == request.from) &&
      (request.lastLogTerm > logTerm(server.log, server.log.length) ||
       (request.lastLogTerm == logTerm(server.log, server.log.length) &&
        request.lastLogIndex >= server.log.length))) {
    granted = true;
    server.votedFor = request.from;
    server.electionAlarm = makeElectionAlarm(model.time);
  }
  sendReply(model, request, {
    term: server.term,
    granted: granted,
  });
};

var handleRequestVoteReply = function(model, server, reply) {
  if (server.term < reply.term)
    stepDown(model, server, reply.term);
  if (server.state == 'candidate' &&
      server.term == reply.term) {
    server.rpcDue[reply.from] = util.Inf;
    server.voteGranted[reply.from] = reply.granted;
  }
};

var handleAppendEntriesRequest = function(model, server, request) {
  var success = false;
  var matchIndex = 0;
  if (server.term < request.term)
    stepDown(model, server, request.term);
  if (server.term == request.term) {
    server.state = 'follower';
    server.electionAlarm = makeElectionAlarm(model.time);
    if (request.prevIndex === 0 ||
        (request.prevIndex <= server.log.length &&
         logTerm(server.log, request.prevIndex) == request.prevTerm)) {
      success = true;
      var index = request.prevIndex;
      for (var i = 0; i < request.entries.length; i += 1) {
        index += 1;
        if (logTerm(server.log, index) != request.entries[i].term) {
          while (server.log.length > index - 1)
            server.log.pop();
          server.log.push(request.entries[i]);
        }
      }
      matchIndex = index;
      server.commitIndex = Math.max(server.commitIndex,
                                    request.commitIndex);
    }
  }
  sendReply(model, request, {
    term: server.term,
    success: success,
    matchIndex: matchIndex,
  });
};

var handleAppendEntriesReply = function(model, server, reply) {
  if (server.term < reply.term)
    stepDown(model, server, reply.term);
  if (server.state == 'leader' &&
      server.term == reply.term) {
    if (reply.success) {
      server.matchIndex[reply.from] = Math.max(server.matchIndex[reply.from],
                                               reply.matchIndex);
      server.nextIndex[reply.from] = reply.matchIndex + 1;
    } else {
      server.nextIndex[reply.from] = Math.max(1, server.nextIndex[reply.from] - 1);
    }
    server.rpcDue[reply.from] = 0;
  }
};

var handleMessage = function(model, server, message) {
  if (server.state == 'stopped')
    return;
  if (message.type == 'RequestVote') {
    if (message.direction == 'request')
      handleRequestVoteRequest(model, server, message);
    else
      handleRequestVoteReply(model, server, message);
  } else if (message.type == 'AppendEntries') {
    if (message.direction == 'request')
      handleAppendEntriesRequest(model, server, message);
    else
      handleAppendEntriesReply(model, server, message);
  }
};


raft.update = function(model) {
  model.servers.forEach(function(server) {
    rules.startNewElection(model, server);
    rules.becomeLeader(model, server);
    rules.advanceCommitIndex(model, server);
    server.peers.forEach(function(peer) {
      rules.sendRequestVote(model, server, peer);
      rules.sendAppendEntries(model, server, peer);
    });
  });
  var deliver = [];
  var keep = [];
  model.messages.forEach(function(message) {
    if (message.recvTime <= model.time)
      deliver.push(message);
    else if (message.recvTime < util.Inf)
      keep.push(message);
  });
  model.messages = keep;
  deliver.forEach(function(message) {
    model.servers.forEach(function(server) {
      if (server.id == message.to) {
        handleMessage(model, server, message);
      }
    });
  });
};

raft.networkFailure = function(model, server) {
  server.state = 'stopped';
  server.electionAlarm = 0;
  dropMessagesForServer(model, server.id);
};

raft.networkRecovery = function(model, server) {
  server.state = 'follower';
  server.electionAlarm = makeElectionAlarm(model.time);
};

raft.stop = function(model, server) {
  server.state = 'stopped';
  server.log = server.log.slice(0, server.commitIndex);
  server.electionAlarm = 0;
};

raft.resume = function(model, server) {
  server.state = 'follower';
  server.electionAlarm = makeElectionAlarm(model.time);
};

raft.resumeAll = function(model) {
  model.servers.forEach(function(server) {
    raft.resume(model, server);
  });
};

raft.drop = function(model, message) {
  model.messages = model.messages.filter(function(m) {
    return m !== message;
  });
};

raft.timeout = function(model, server) {
  server.state = 'follower';
  server.electionAlarm = 0;
  // 立即更新一次状态机，触发选举
  raft.update(model);
};

raft.clientRequest = function(model, server) {
  if (server.state == 'leader') {
    server.log.push({term: server.term,
                     value: 'v'});
  }
};

raft.spreadTimers = function(model) {
  var timers = [];
  model.servers.forEach(function(server) {
    if (server.electionAlarm > model.time &&
        server.electionAlarm < util.Inf) {
      timers.push(server.electionAlarm);
    }
  });
  timers.sort(util.numericCompare);
  if (timers.length > 1 &&
      timers[1] - timers[0] < MAX_RPC_LATENCY) {
    if (timers[0] > model.time + MAX_RPC_LATENCY) {
      model.servers.forEach(function(server) {
        if (server.electionAlarm == timers[0]) {
          server.electionAlarm -= MAX_RPC_LATENCY;
          console.log('adjusted S' + server.id + ' timeout forward');
        }
      });
    } else {
      model.servers.forEach(function(server) {
        if (server.electionAlarm > timers[0] &&
            server.electionAlarm < timers[0] + MAX_RPC_LATENCY) {
          server.electionAlarm += MAX_RPC_LATENCY;
          console.log('adjusted S' + server.id + ' timeout backward');
        }
      });
    }
  }
};

raft.alignTimers = function(model) {
  raft.spreadTimers(model);
  var timers = [];
  model.servers.forEach(function(server) {
    if (server.electionAlarm > model.time &&
        server.electionAlarm < util.Inf) {
      timers.push(server.electionAlarm);
    }
  });
  timers.sort(util.numericCompare);
  model.servers.forEach(function(server) {
    if (server.electionAlarm == timers[1]) {
      server.electionAlarm = timers[0];
      console.log('adjusted S' + server.id + ' timeout forward');
    }
  });
};

// 日志记录函数
raft.log = function(message) {
    var logContainer = $('#log-container');
    var time = new Date().toLocaleTimeString();
    logContainer.append('<div>[' + time + '] ' + message + '</div>');
    logContainer.scrollTop(logContainer[0].scrollHeight);
};

// 复杂场景测试
raft.testComplexScenario = function(model) {
    // 清空日志
    $('#log-container').empty();
    
    return new Promise(function(resolve) {
        var startTime = model.time;
        var currentStep = 0;
        var steps = [
            // 步骤1: Server 1 成为 leader
            function() {
                raft.log('步骤1: 等待Server 1成为leader...');
                var server1 = model.servers[0];
                // 强制其他服务器的选举超时时间晚于Server 1
                model.servers.forEach(function(server) {
                    if (server.id !== 1) {
                        server.electionAlarm = model.time + ELECTION_TIMEOUT * 2;
                    }
                });
                server1.electionAlarm = model.time + ELECTION_TIMEOUT;
                return function() {
                    // 确保Server 1是leader且获得了多数服务器的投票
                    return server1.state === 'leader' && 
                           util.countTrue(util.mapValues(server1.voteGranted)) + 1 > Math.floor(NUM_SERVERS / 2);
                };
            },
            
            // 步骤2: 向Server 1发送第一个请求
            function() {
                raft.log('步骤2: 向Server 1发送第一个请求...');
                var server1 = model.servers[0];
                raft.clientRequest(model, server1);
                return function() {
                    // 确保请求被复制到大多数服务器
                    var replicatedCount = 1; // leader自己
                    model.servers.forEach(function(server) {
                        if (server.id !== server1.id && server.log.length >= 1) {
                            replicatedCount++;
                        }
                    });
                    return server1.log.length === 1 && replicatedCount > Math.floor(NUM_SERVERS / 2);
                };
            },
            
            // 步骤3: 向Server 1发送第二个请求
            function() {
                raft.log('步骤3: 向Server 1发送第二个请求...');
                var server1 = model.servers[0];
                raft.clientRequest(model, server1);
                return function() {
                    // 确保请求被复制到大多数服务器
                    var replicatedCount = 1; // leader自己
                    model.servers.forEach(function(server) {
                        if (server.id !== server1.id && server.log.length >= 2) {
                            replicatedCount++;
                        }
                    });
                    return server1.log.length === 2 && replicatedCount > Math.floor(NUM_SERVERS / 2);
                };
            },
            
            // 步骤4: Server 1宕机
            function() {
                raft.log('步骤4: Server 1宕机..., Server 2成为leader...');
                var server1 = model.servers[0];
                var server2 = model.servers[1];
                raft.networkFailure(model, server1);
                // 强制其他服务器的选举超时时间晚于Server 2
                model.servers.forEach(function(server) {
                  if (server.id !== 2) {
                      server.electionAlarm = model.time + ELECTION_TIMEOUT * 4;
                  }
                });
                server2.electionAlarm = model.time + ELECTION_TIMEOUT;
                return function() {
                    return server1.state === 'stopped' && server2.state === 'leader';
                };
            },
            
            // 步骤5: 尝试向Server 1发送第三个请求（会失败）s
            function() {
                raft.log('步骤5: 尝试向已宕机的Server 1发送请求...');
                var server1 = model.servers[0];
                raft.clientRequest(model, server1);
                return function() {
                    return true; // 直接进入下一步
                };
            },
            
            // 步骤6: Server 4和5宕机
            function() {
                raft.log('步骤6: Server 4和5网络故障...');
                raft.networkFailure(model, model.servers[3]); // Server 4
                raft.networkFailure(model, model.servers[4]); // Server 5
                return function() {
                    return model.servers[3].state === 'stopped' && 
                           model.servers[4].state === 'stopped';
                };
            },
            
            // 步骤7: 在只有2个节点可用时向Server 2发送请求
            function() {
                raft.log('步骤7: 在只有2个节点可用时向Server 2发送请求...');
                var server2 = model.servers[1];
                raft.clientRequest(model, server2);
                return function() {
                    return true;
                };
            },
            
            // 步骤8: 关闭Server 2和3
            function() {
                raft.log('步骤8: Server 2和3网络故障...');
                raft.networkFailure(model, model.servers[1]); // Server 2
                raft.networkFailure(model, model.servers[2]); // Server 3
                return function() {
                    return model.servers[1].state === 'stopped' && 
                           model.servers[2].state === 'stopped';
                }
            },
            // 步骤9: 重启Server 1、4和5
            function() {
                raft.log('步骤9: 恢复Server 1、4和5...');
                raft.networkRecovery(model, model.servers[0]); // Server 1
                raft.networkRecovery(model, model.servers[3]); // Server 4
                raft.networkRecovery(model, model.servers[4]); // Server 5
                var server5 = model.servers[4];
                model.servers.forEach(function(server) {
                  if (server.id !== 5 && server.state !== 'stopped') {
                      server.electionAlarm = model.time + ELECTION_TIMEOUT * 4;
                  }
                });
                // for (var i = 1; i < NUM_SERVERS; i++) {
                //   raft.log('Server ' + i + ' state: ' + model.servers[i].state);
                //   raft.log('Server ' + i + ' electionAlarm: ' + model.servers[i].electionAlarm);
                // }
                server5.electionAlarm = model.time + ELECTION_TIMEOUT;
                return function() {
                    return model.servers[1].state === 'stopped' && 
                           model.servers[2].state === 'stopped' &&
                           model.servers[0].state !== 'stopped' &&
                           model.servers[3].state !== 'stopped' &&
                           model.servers[4].state !== 'stopped';
                };
            },
            // 步骤10: 等待Server 5成为leader
            function() {
                raft.log('步骤10: 等待Server 5成为leader...');
                var server5 = model.servers[4]; 
                return function() {
                    // 确保Server 5是leader且获得了多数服务器的投票
                    return server5.state === 'leader' && 
                           util.countTrue(util.mapValues(server5.voteGranted)) + 1 > Math.floor(NUM_SERVERS / 2);
                };
            },
            
            // 步骤11: 向Server 1发送新请求
            function() {
                raft.log('步骤11: 向Server 5发送新请求...');
                var server5 = model.servers[4];
                raft.clientRequest(model, server5);
                return function() {
                    // 确保请求被复制到所有可用的服务器（1、4、5）
                    var replicatedCount = 1; // leader自己
                    for (var i = 0; i < NUM_SERVERS; i++) {
                        if (model.servers[i].state !== 'stopped' && 
                            model.servers[i].id !== server5.id && 
                            model.servers[i].log.length === server5.log.length) {
                            replicatedCount++;
                        }
                    }
                    return server5.log.length > 2 && replicatedCount >= 2; // 需要2个follower确认
                };
            },
            
            // 步骤11: 重启Server 2和3
            function() {
                raft.log('步骤11: Server 2和3网络恢复...');
                raft.networkRecovery(model, model.servers[1]); // Server 2
                raft.networkRecovery(model, model.servers[2]); // Server 3
                return function() {
                    // 确保Server 2和3恢复，并且它们的日志被覆盖
                    var server5 = model.servers[4]; // 当前leader
                    return model.servers[1].state !== 'stopped' && 
                           model.servers[2].state !== 'stopped' &&
                           model.servers[1].log.length === server5.log.length &&
                           model.servers[2].log.length === server5.log.length;
                };
            },
        ];
        
        var currentStepStartTime = model.time;
        var maxStepTime = ELECTION_TIMEOUT * 10; // 增加最大等待时间
        // 增加步骤间等待时间，确保有足够的心跳
        var minHeartbeats = 1; // 增加到10次心跳
        var stepWaitTime = (ELECTION_TIMEOUT / 2) * minHeartbeats;
        
        var updateInterval = setInterval(function() {
            // 检查是否暂停
            if (playback.isPaused()) {
                return;
            }
            
            // 每次只更新一次状态机，让交互更容易观察
            raft.update(model);
            
            // 检查当前步骤是否完成
            if (currentStep < steps.length) {
                // 首次执行当前步骤
                if (!steps[currentStep].checker) {
                    steps[currentStep].checker = steps[currentStep]();
                    currentStepStartTime = model.time;
                    steps[currentStep].startTime = Date.now();
                }
                
                // 检查步骤是否完成
                if (steps[currentStep].checker() && !steps[currentStep].completed) {
                    // 确保经过了足够的心跳时间
                    var elapsedTime = model.time - currentStepStartTime;
                    if (elapsedTime >= stepWaitTime) {
                        steps[currentStep].completed = true;
                        raft.log('步骤' + (currentStep + 1)+': 完成');
                        
                        // 在进入下一步之前额外等待一段时间
                        setTimeout(function() {
                            if (!playback.isPaused()) {  // 检查是否暂停
                                currentStep++;
                                if (currentStep < steps.length) {
                                    currentStepStartTime = model.time;
                                    // raft.log('开始步骤 ' + (currentStep + 1));
                                } else {
                                    // 所有步骤完成
                                    clearInterval(updateInterval);
                                    raft.log('测试完成！');
                                    resolve({ success: true });
                                }
                            }
                        }, 1000); // 步骤之间等待2秒
                    }
                } else if (model.time - currentStepStartTime > maxStepTime) {
                    // 步骤超时
                    clearInterval(updateInterval);
                    raft.log('步骤 ' + (currentStep + 1) + ' 超时');
                    resolve({ success: false, message: '步骤 ' + (currentStep + 1) + ' 超时' });
                }
            }
            
            // 使用与script.js相同的速度计算逻辑
            var wallMicrosElapsed = 50 * 1000; // 50ms转换为微秒
            var speed = speedSliderTransform($('#speed').slider('getValue'));
            var modelMicrosElapsed = wallMicrosElapsed / speed;
            
            if (!playback.isPaused()) {
                model.time += modelMicrosElapsed;
            }
        }, 50);
        
        // 添加清理函数
        return {
            then: function(callback) {
                resolve = callback;
            },
            stop: function() {
                clearInterval(updateInterval);
            }
        };
    });
};

// 提交规则演示
raft.submitRuleDemo = function(model) {
    // 清空日志
    $('#log-container').empty();
    
    return new Promise(function(resolve) {
        var startTime = model.time;
        var currentStep = 0;
        var steps = [
            // 步骤1: Server 1 成为 leader
            function() {
                raft.log('步骤1: 初始Leader为Server 1');
                var server1 = model.servers[0];
                // 强制其他服务器的选举超时时间晚于Server 1
                model.servers.forEach(function(server) {
                    if (server.id !== 1) {
                        server.electionAlarm = model.time + ELECTION_TIMEOUT * 2;
                    }
                });
                raft.timeout(model, server1);
                return function() {
                    // 确保Server 1是leader且获得了多数服务器的投票
                    return server1.state === 'leader' && 
                           util.countTrue(util.mapValues(server1.voteGranted)) + 1 > Math.floor(NUM_SERVERS / 2);
                };
            },
            
            // 步骤2: 向Server 1发送请求
            function() {
                raft.log('步骤2: 向Server 1发送请求，并等待其提交');
                var server1 = model.servers[0];
                raft.clientRequest(model, server1);
                return function() {
                    // 确保请求被复制到大多数服务器
                    var replicatedCount = 1; // leader自己
                    model.servers.forEach(function(server) {
                        if (server.id !== server1.id && server.log.length >= 1) {
                            replicatedCount++;
                        }
                    });
                    return server1.log.length === 1 && replicatedCount > Math.floor(NUM_SERVERS / 2);
                };
            },

            // 步骤3
            function() {
              raft.log('步骤3: 再次发起请求');

              var server1 = model.servers[0];
              var server2 = model.servers[1];
              raft.clientRequest(model, server1);
              raft.log('步骤3: 网络故障! 只有Server 2收到了AppendEntry');
              raft.enableAppendEntries = false;
              rules.sendAppendEntriesToSome(model, server1, 2);
              rules.sendAppendEntriesToSome(model, server1, 2);

              return function() {
                  // 确保server 2的日志长度为2
                  return server2.log.length === 2;
              };
          },

          // 步骤4: server 1 宕机
          function() {
            raft.log('步骤4: Server 1网络故障, Server 5成为Leader');
            var server1 = model.servers[0];
            var server5 = model.servers[4];
            raft.networkFailure(model, server1);
             // 强制其他服务器的选举超时时间晚于Server 5
             model.servers.forEach(function(server) {
              if (server.id !== 5) {
                  server.electionAlarm = model.time + ELECTION_TIMEOUT * 2;
              }
            });
            server5.electionAlarm = model.time + ELECTION_TIMEOUT;
            return function() {
                return server5.state === 'leader' && 
                       util.countTrue(util.mapValues(server5.voteGranted)) + 1 > Math.floor(NUM_SERVERS / 2);
            };
          },

          // 步骤5: 向server 5发送新请求
          function() {
            raft.log('步骤5: 向Server 5发送新请求');
            var server5 = model.servers[4];
            raft.clientRequest(model, server5);
            raft.log('步骤5: 但Server 5还没AppendEntry');
            return function() {
                return server5.log.length === 2;
            };  
          },
          //步骤6: server 5 宕机, server 1 成为leader
          function() {
            raft.log('步骤6: Server 5网络故障, Server 1网络恢复成为Leader');
            var server1 = model.servers[0];
            var server5 = model.servers[4];
            raft.networkRecovery(model, server1);
            raft.networkFailure(model, server5);
            // 强制其他服务器的选举超时时间晚于Server 1
            server1.electionAlarm = model.time + ELECTION_TIMEOUT;
            model.servers.forEach(function(server) {
              if (server.id !== 1) {
                  server.electionAlarm = model.time + ELECTION_TIMEOUT * 2;
              }
            });
            return function() {
                return server1.state === 'leader';
            };
          },

          // 步骤7: 向server 1发送新请求
          function() {
            raft.log('步骤7: 向Server 1发送新请求');
            var server1 = model.servers[0];
            var server3 = model.servers[2];
            raft.clientRequest(model, server1);
            rules.sendAppendEntriesToSome(model, server1, 3);
            setTimeout(() => rules.sendAppendEntriesToSome(model, server1, 3), 1000)
            rules.sendAppendEntriesToSome(model, server1, 3);
            raft.log('步骤7: Server 1 Append了部分旧Entry');
            return function() {
                return server1.log.length === 3 && server3.log.length === 2;
            };
          },
          // 步骤8: server 1 宕机, server 5 成为leader
          function() {
            raft.log('步骤8: Server 1同步Entry时网络故障');
            raft.log('步骤8: Server 5成为Leader');
            var server1 = model.servers[0];
            var server5 = model.servers[4];
            raft.networkRecovery(model, server5);
            raft.networkFailure(model, server1);
            // 强制其他服务器的选举超时时间晚于Server 5
            server5.electionAlarm = model.time + ELECTION_TIMEOUT;
            model.servers.forEach(function(server) {
              if (server.id !== 5) {
                  server.electionAlarm = model.time + ELECTION_TIMEOUT * 2;
              }
            });
            return function() {
                return server5.state === 'leader';
            };
          },  

          // 步骤9: 向server 5发送新请求
          function() {
            raft.log('步骤9: 向Server 5发送新请求并Append到Follower');
            var server1 = model.servers[0];
            var server5 = model.servers[4];
            raft.networkRecovery(model, server1);
            raft.enableAppendEntries = true;
            raft.clientRequest(model, server5);
            return function() {
                var replicatedCount = 1; // leader自己
                model.servers.forEach(function(server) {
                    // raft.log('server'+server.id+' length '+server.log.length);
                    if (server.id !== server5.id && server.log.length === server5.log.length) {
                        replicatedCount++;
                    }
                });
                return server5.log.length === 3 && replicatedCount == NUM_SERVERS;
            };
          }
        ];
        
        var currentStepStartTime = model.time;
        var maxStepTime = ELECTION_TIMEOUT * 20;
        var minHeartbeats = 2;
        var stepWaitTime = (ELECTION_TIMEOUT / 2) * minHeartbeats;
        
        var updateInterval = setInterval(function() {
            // 检查是否暂停
            if (playback.isPaused()) {
                return;
            }
            
            // 每次只更新一次状态机，让交互更容易观察
            raft.update(model);
            
            // 检查当前步骤是否完成
            if (currentStep < steps.length) {
                // 首次执行当前步骤
                if (!steps[currentStep].checker) {
                    steps[currentStep].checker = steps[currentStep]();
                    currentStepStartTime = model.time;
                    steps[currentStep].startTime = Date.now();
                }
                
                // 检查步骤是否完成
                if (steps[currentStep].checker() && !steps[currentStep].completed) {
                    // 确保经过了足够的心跳时间
                    var elapsedTime = model.time - currentStepStartTime;
                    if (elapsedTime >= stepWaitTime) {
                        steps[currentStep].completed = true;
                        raft.log('步骤' + (currentStep + 1) + ': 完成');
                        
                        // 在进入下一步之前额外等待一段时间
                        setTimeout(function() {
                            if (!playback.isPaused()) {
                                currentStep++;
                                if (currentStep < steps.length) {
                                    currentStepStartTime = model.time;
                                } else {
                                    // 所有步骤完成
                                    clearInterval(updateInterval);
                                    raft.log('规则演示完成！');
                                    raft.log('原本Server 1 Append到多数的log最后被Server 5覆盖！');
                                    resolve({ success: true });
                                }
                            }
                        }, 1000);
                    }
                } else if (model.time - currentStepStartTime > maxStepTime) {
                    // 步骤超时
                    clearInterval(updateInterval);
                    raft.log('步骤 ' + (currentStep + 1) + ' 超时');
                    resolve({ success: false, message: '步骤 ' + (currentStep + 1) + ' 超时' });
                }
            }
        }, 100);
    });
};

})();
