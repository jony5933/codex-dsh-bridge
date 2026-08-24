# DSH rc.8 Web Host 协议探测

更新日期：2026-08-21

## 结论

M7 的 `WebHostTransport` 可以基于 rc.8 已有的 `/api` 控制面实现，不需要修改 DSH Web UI，也不需要使用 subagent。可用能力包括 HTTP unary RPC、两条 WebSocket 实时下行、session create/prompt/cancel/history，以及基于 event `seq` 的历史补偿。

需要修正原计划中的两点：

1. Web 实时下行是 WebSocket，不是 SSE；普通 GET `/api/events.mux` 或 `/api/events.host` 返回 HTTP 426 是协议预期。
2. rc.8 的不兼容 SQLite 数据是可重建的全文搜索派生索引，不是 `.jsonl.zstd` 权威会话日志，因此不构成 M7 的 session migration blocker。

## 本机实测

| 项目 | 结果 |
| --- | --- |
| DSH | `0.1.0-rc.8` |
| Web Host | `127.0.0.1:3080` |
| `host.describe` | HTTP 200；provider `deepseek-official`，model `deepseek-v4-flash` |
| `session.list` | HTTP 200；同时列出 rc.7 旧会话与 rc.8/headless 新会话 |
| `/api/events.host` 普通 GET | HTTP 426，要求 WebSocket upgrade |
| `/api/events.mux` WebSocket | 连接成功，收到真实 `session/subscribed` baseline 与 `lastSeq` |
| 权威 session 存储 | `~/.dsh/sessions/**/session.jsonl.zstd` |
| SQLite search index | base 配置为 `path: ':memory:'`、`openAt: never`；本机无持久文件 |

本轮只执行只读 RPC 和只读 WebSocket 订阅，没有创建会话、发送 prompt、修改 profile 或写入目标仓库。

机器可读证据：[`docs/validation-evidence-summary.md`](validation-evidence-summary.md)。

## 可采用的协议能力

### HTTP unary RPC

请求发送到 `POST /api/<method>`，使用 `client-request` envelope 并回显 `rpcId`。MVP 需要：

- `host.describe`：启动握手、版本与 Host identity 记录；
- `workspace.list/create`：按 canonical execution path 解析或幂等创建 Workspace；
- `session.create`：使用 Bridge 预分配的 `sessionId` 和解析后的 `workspaceId`；
- `session.prompt`：发送 Runner 已渲染的固定执行 prompt；
- `session.history`：启动基线、断线补偿和最终 transcript 核验；
- `session.cancel`：timeout 或用户取消时终止活动 turn；
- `session.list`：诊断与恢复时确认持久 session 是否存在。

rc.8 的 `session.create` 要求 `workspaceId` 与 `cwd` 二选一。Bridge 使用 `workspaceId + sessionId`；创建后重新读取 `workspace.list`，确认 Workspace 的 `sessionIds` 包含目标 session。`host/session-added` 不携带 `workspaceId`，不能单独证明正确分组。

### WebSocket 下行

- `/api/events.mux`：`session/event`、`session/subscribed`、approval、question、queue、jobs 和 projection；
- `/api/events.host`：`host/session-added`、`host/session-status`、`host/agent-error` 等 Host 生命周期事件。

浏览器和 Runner 连接同一个 Web Host 后会消费同一事件源，因此 Web UI 可以实时显示 Runner 创建的 session。当前 headless 方式由另一个进程直接写 session root，正在运行的 Web Host 不会收到 `host/session-added`，所以 UI 需要重新加载；是否固定到程序坞不影响该行为。

### 完成判断

Web Host 没有可等价替代进程 exit code 的单一字段。MVP 必须组合以下证据：

1. `session.prompt` 返回 `accepted: true`；
2. mux 中观察到目标 session 的连续 event `seq`；
3. 观察到目标 turn 的 `turn/end`；
4. Host 状态最终变为 `running: false`；
5. 没有 `host/agent-error`、未解决 approval/question 或协议 gap；
6. 最后重新读取 `session.history`，补齐并核对终止位置；
7. `web-guarded` 再独立执行 Git policy audit、required/acceptance checks、边界验证和 patch 生成；`web-direct` 把终止证据交回 Codex review。

DSH 的最终文本仍不是成功凭据。`web-direct` 至少需要协议终止证据和 Codex review；`web-guarded` 还必须通过 Runner 的确定性检查。

## 不采用或只作参考的 rc.8 能力

### `reportDelivery`

`reportDelivery` 只服务 continuable in-process child 的 `report` 工具：

- root Agent、one-shot child 和远程 provider 不具备该通道；
- `next-step` 会 steer/wake 直接父 Agent，`quiet` 只 inject；
- 接受不等于持久投递，没有 exactly-once、离线 mailbox 或已读回执。

它不能作为 Runner → Web Host 的完成信号，也不能替代 session event 与 Runner checks。报告中的唤醒语义可保留为架构参考，但不进入 M7 transport dependency。

### `dsh-jobs`

Job registry 是进程内、非持久状态，owner 销毁和 Host 重启都会改变可见集合。`session/jobs` 是 UI snapshot，不是跨进程审计日志。因此：

- 可借鉴 `running / stopping / completed / killed / failed` 命名；
- 不复用 Job id 作为 Runner run id；
- 不把 Job terminal status 作为代码任务成功证据；
- Runner 的 `runId`、`sessionId`、event seq 与 artifacts 必须独立持久化。

## M7 MVP transport 约束

1. 仅允许显式 loopback endpoint，默认 `http://127.0.0.1:3080`；不自动连接 LAN Host。
2. 启动时必须完成 `host.describe`，并将 Host version、endpoint 和默认 model 写入 artifact。
3. 把 execution path canonicalize 后解析为 `workspaceId`，使用 `workspaceId + sessionId` 创建并核验归属；`web-direct` 只允许用户明确指定的项目，`web-guarded` 使用隔离 worktree。
4. prompt 只允许发送一次。只有在尚未获得 `accepted: true` 时才能 fallback 到 headless，防止重复修改。
5. `events.mux` 的 `since` 在 rc.8 v1 中未实现；任何重连都必须重新读取 history，并按 `lastSeq` 检测 gap 与重复帧。
6. approval/question 不得自动批准或虚构答案。MVP 遇到时标记 `blocked`，请求人工处理或取消 session。
7. timeout 先调用 `session.cancel`，等待 `running: false`；若 Host 断连或无法确认停止，run 必须 `failed`，不能启动 fallback 重做。
8. Web Host 是共同 transport；隔离 worktree、事后 Git ref audit、checks、boundary 和完整 artifacts 只在 `web-guarded` 启用，Codex review 与人工裁决保持不变。rc.8 `session.create` 没有 per-session environment 或 Skill patch，因此 Web 通道不能继承 headless 的 Git `PATH` wrapper 或隔离 Skill catalog，evidence 必须显式记录这一能力缺口。
9. Host API 当前没有独立 protocol version，client 与 Host 随 DSH 一起发布。实现必须把 rc.8 schema 固定在 adapter 内，并在升级 DSH 时重新运行协议 contract tests。

## 实施顺序

1. ✅ 抽象内部 `HarnessTransport` 与通用 execution result，现有 `HeadlessTransport` 已通过同一接口运行且结果不变。
2. ✅ rc.8 Web Host client、session coordinator 与 Workspace 分组已完成：HTTP envelope、WebSocket 两流、rpcId、canonical Workspace、连续 seq、turn/end、idle 与最终 history 核验。
3. ✅ fake Host 已覆盖 create/prompt/completion、gap、disconnect、approval/question、agent-error、全程 timeout、cancel settle 与 cancel-unconfirmed。
4. ✅ 断线后的 history recovery 已完成：双流重建、完整分页、seq 补偿、`session.list` running 对账、重连上限和 prompt exactly-once 均有 fake Host 测试。
5. ✅ 已包装双模式 `WebHostTransport` 与 transport evidence：保留 session/Workspace/reconnect 原生证据，不伪造 process `exitCode`；`web-guarded` 的后置控制标为 `caller-required`，不支持的环境与 Skill 注入标为 `false`。
6. ✅ 已在专用测试项目完成真实 Web Host smoke；用户确认 Web UI 无需刷新即可看到正确 Workspace 下的新 session。
7. ✅ `web-direct` 已设为推荐入口；`headless` 继续作为显式选择，不做 prompt 已接受后的自动 fallback。

真实协议 smoke 已完成：`web-direct` 在 `<validation-repository>` 创建了正确分组的 Workspace/session，prompt、running、terminal event、最终 history 和目标仓库不变性均通过核验；用户随后确认已打开的 DSH UI 无需刷新即出现了该 session。机器证据见 `docs/validation-evidence-summary.md`。

## 依据

- DSH rc.8 release notes；
- 本机 `@deepseek-ai/dsh-host-apiproxy`、`dsh-client-connection`、`dsh-session-persistence-jsonl`、`dsh-session-query-sqlite`、`dsh-tool-subagent-report` 与 `dsh-jobs` rc.8 安装包；
- 本机 Web Host 的 `host.describe`、`session.list` 和 `/api/events.mux` 只读探测。
- 新 client 的只读 `host.describe` 与双 WebSocket live smoke；证据见 `docs/validation-evidence-summary.md`。
- 本机 rc.8 `dsh-client-connection` 与 `dsh-host-apiproxy` 的 Workspace schema/handler 只读复核，以及 73/73 fake Host 自动测试。
