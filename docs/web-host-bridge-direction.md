# Codex → DSH Web Host Bridge 方向说明

更新日期：2026-08-21

## 决策

项目正式从“默认经过安全 Runner 的 Codex → DSH 闭环”调整为：

> 为 Codex 提供一个标准化、实时可见、正确分组的 DSH Web Host 通道，并在需要时附加安全控制。

三轮通道基准没有证明 Runner 比直接调用更快或更省 Token。Runner 的有效资产是隔离、边界、检查和审计；Web Host 的独特价值则是让 Codex 发起的工作进入 DSH 正在运行的控制面，用户无需刷新即可观察，并能按项目正确归档。

## 双模式

| 模式 | 默认用途 | 执行位置 | 控制 | 主要收益 |
| --- | --- | --- | --- | --- |
| `web-direct` | 日常、低风险、单次任务 | 用户指定项目 | 单次 prompt、超时、取消、协议校验、完成证据 | 快速、实时可见、正确 `Workspace` 分组 |
| `web-guarded` | 高风险、批量、无人值守或需审计任务 | 隔离 Git worktree | 在 `web-direct` 之外附加 Contract、Git policy、checks、路径边界和 artifacts | 可重复、fail-closed、可审计 |

两种模式共用同一个 Web Host client、session coordinator、`WorkspaceResolver` 和终止状态模型。安全 Runner 是可插拔策略层，不复制一套 Web Host 实现。

## 标准流程

```text
Codex 计划与任务说明
  → Bridge 接收 projectPath、mode 和 prompt
  → WorkspaceResolver 规范化路径
  → workspace.list 精确匹配；不存在时 workspace.create
  → session.create({ workspaceId, sessionId })
  → 建立 Host / session 双事件流并读取 history baseline
  → session.prompt（只发送一次）
  → DSH Web UI 实时显示 session、running 与输出
  → terminal event + final history 对账
  → 返回结构化 evidence
  → Codex review
```

`web-guarded` 会在创建 session 前准备隔离 worktree，并在 session 终止后执行确定性检查、边界核验和 patch 生成。

## Workspace 分组规则

- 输入必须是明确的项目绝对路径，Bridge 对其做 canonical path 解析。
- 先调用 `workspace.list`，只接受 canonical path 完全一致的 Workspace。
- 未找到时调用幂等的 `workspace.create({ path })`，再取得 `workspaceId`。
- session 必须以 `session.create({ workspaceId, sessionId })` 创建，不能只传 `cwd`。
- 创建后必须从 Host 事件或查询结果确认 session 属于预期 Workspace。
- 历史 headless session 暂不自动迁移；在 attach 语义被独立验证前，不批量修改或删除用户 session。
- `Ungrouped` 是 DSH 的虚拟归类，不是应当调用删除 API 清理的 Workspace。

## 最小权限面

M7 只在现有 allowlist 上增加：

- `workspace.list`
- `workspace.create`

继续允许 `host.describe`、`session.list/create/history/prompt/cancel`。不开放 settings、credentials、filesystem、Workspace 删除或 session 删除；approval/question 不自动批准。prompt 发出后禁止自动切换到 headless，避免重复执行。

## MVP 验收

真实 smoke 必须同时证明：

1. Codex 能用项目路径和一份任务说明启动一次 Web Host session。
2. session 出现在指定 `Workspace`，不进入 `Ungrouped`。
3. 已打开的 DSH Web UI 无需刷新即可看到新 session、运行状态和增量输出。
4. prompt 恰好发送一次；断线、seq gap、approval/question、Host error 和 timeout 均 fail closed。
5. 正常完成由 terminal event、running 状态和最终 history 共同确认，不能伪造 process exit code。
6. Bridge 返回足够的结构化 evidence，Codex 可据此打开 diff 并 review。
7. `web-guarded` 能复用隔离 worktree、事后 Git ref audit、checks、boundary 和 artifacts，且不会改变 `web-direct` 的轻量默认语义；rc.8 不支持的 per-session environment、Git wrapper 与 Skill patch 必须在 evidence 中明确标为不可用。

## 不做的事情

- 不把 Bridge 宣称为 DSH 加速器或 Token 优化器。
- 不复制 Codex 已有的 Git Review UI。
- 不改造或 fork DSH Web UI。
- 不在 MVP 中建设通用远程服务、账户系统、凭据管理或 ACP 平台。
- 不自动 commit、merge、push、批准交互或删除 Workspace/session。

## 收口条件

分组真实 smoke 已通过，项目默认方向已收口为 `web-direct`；guarded Runner 保留为显式选择。后续只推进 Bridge 交付、配置和持久 evidence，不继续扩建重复 Git Review UI。
