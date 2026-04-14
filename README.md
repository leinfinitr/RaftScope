# Raft Scope

一个运行在浏览器里的 Raft 可视化演示项目，适合课堂展示、论文讲解和手动观察 leader election / log replication 的过程。

## 这个项目演示什么

- leader election、term 变化和心跳
- `RequestVote` 与 `AppendEntries` 消息流转
- 日志复制、冲突回退、`nextIndex` / `matchIndex` 变化
- `commitIndex` 在多数复制后的推进
- 节点故障、恢复、消息丢弃对一致性的影响
- 两个内置的脚本化演示场景

## 快速开始

先初始化子模块：

```bash
git submodule update --init --recursive
```

然后任选一种方式运行：

- 直接在浏览器打开根目录下的 `index.html`
- 或者在仓库根目录启动一个静态服务器后访问页面

例如：

```bash
python -m http.server 8000
```

## 怎么开始演示

打开页面后，建议先做这几步：

1. 先观察五个节点、右侧日志区和底部时间轴。
2. 等待自动选出 leader，或者对某个节点触发 `time out`。
3. 按 `C` 或给 leader 执行 `request`，观察日志复制和提交。
4. 需要更完整的课堂演示时，使用顶部两个按钮。

两个按钮的用途：

- `测试复杂场景`：演示 leader 切换、集群失去多数、节点恢复后重新追平日志。
- `提交规则演示`：演示冲突日志和未提交日志如何被新 leader 的日志覆盖。

## 详细文档

更完整的使用方式、功能说明、推荐演示流程和已知限制见 [docs/demo-guide.md](docs/demo-guide.md)。

## 已知限制

这个仓库更偏教学演示，不是完整的生产级 Raft 实现。当前没有 snapshot / `InstallSnapshot`、成员变更和真实状态机应用层；帮助弹窗中的 `L` 快捷键对应的预设场景也与当前代码不一致，不建议使用。
