# Raft Documentation Design

**Date:** 2026-04-14

## Goal

为仓库补齐两层文档：

- 根目录 `README` 作为入口页，帮助第一次接触项目的人在几分钟内理解项目定位、完成启动，并知道从哪里开始演示。
- `docs/demo-guide.md` 作为详细演示手册，面向课程展示、答辩或自学场景，说明项目实际实现了哪些 Raft 功能、界面如何操作、推荐的演示顺序，以及当前实现的边界。

## Verified Repository Behavior

基于对 `index.html`、`raft.js`、`script.js`、`state.js`、`util.js` 的阅读，文档只覆盖当前代码已经实现并能被用户触发的能力：

- 五节点固定集群的 leader election。
- `RequestVote` 与 `AppendEntries` 消息流转和可视化。
- 基于 `nextIndex` / `matchIndex` 的日志复制与冲突回退。
- `commitIndex` 在多数复制后推进。
- 节点 `network failure` / `network recovery` / `stop` / `resume` / `time out` / `request` 等交互。
- 消息点击查看详情与右键丢弃。
- 时间轴拖动、暂停/继续、回放分叉。
- 两个脚本化按钮：
  - `测试复杂场景`
  - `提交规则演示`

文档会明确指出当前没有实现或不建议承诺的内容：

- 没有 `InstallSnapshot` / snapshot 压缩。
- 没有成员变更。
- 没有真实状态机应用层，只是把占位日志项写入日志。
- `L` 快捷键依赖未定义的 `raft.restart`，帮助文案与实际实现不一致。
- `stop` / `resume` 的崩溃恢复模型经过简化，不等同于完整的持久化 Raft 实现。

## Deliverables

### 1. Root README

职责：

- 一句话说明这是浏览器里的 Raft 可视化演示项目。
- 列出项目能演示的核心功能。
- 给出最短启动步骤。
- 说明顶部两个内置按钮各自演示什么。
- 链接到详细指南。

### 2. Detailed Demo Guide

职责：

- 介绍仓库结构和关键文件。
- 说明界面各区域和交互入口。
- 区分“Raft 论文中的能力”和“本项目实际覆盖到的能力”。
- 提供一条可直接照着走的演示流程。
- 逐步解释两个脚本化场景。
- 总结已知限制、简化假设和容易误解的点。

## Writing Principles

- 不夸大实现范围，只写代码里已经存在的能力。
- 保持 `README` 简洁，把细节放进详细指南。
- 优先帮助课堂演示：从“如何启动”和“演示时看什么”出发组织内容。
- 对可疑入口和残留文案直接标注，不在文档里假装它们可用。
