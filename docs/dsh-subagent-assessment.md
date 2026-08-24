# DSH 0.1.1-rc.2 参考性评估与建议

- 评估日期：2026-08-24（初始评估 rc.7：2026-08-17；Codex 复核：2026-08-20；升级 rc.8：2026-08-21；升级 0.1.1-rc.1：2026-08-21；升级 0.1.1-rc.2：2026-08-24）
- 评估对象：`@deepseek-ai/dsh@0.1.1-rc.2`（全局安装 `<dsh-executable>`）的 Codex / Claude Code subagent 能力
- 评估范围：该能力对本仓库"Codex → DSH → Codex 审阅闭环"的参考价值
- 一句话结论：**subagent 功能对本项目的审阅闭环没有功能引用价值，且结构上不应采用；有参考价值的是 Skill 写入方式（服务 M5 配对实验）和 provider 的工程实现（凭据清洗、进程树清理、Job 语义）。本结论版本无关，rc.7→0.1.1-rc.2 未改变核心判断。**

## 1. 版本历史

| 日期 | 事件 |
| --- | --- |
| 2026-08-17 | rc.7 初评：subagent 机制事实核查，得出"不用于审阅、借鉴 Skill 写法与工程实践"的结论 |
| 2026-08-20 | Codex 复核：架构结论成立；本机出现 bundled Codex CLI（`codex-cli 0.148.0-alpha.15`）；凭据清洗建议被采纳；one-shot 表述范围澄清；Codex CLI structured-output 探测完成 |
| 2026-08-21 | 升级 rc.8：全局安装、profiles 重建、契约改 PATH 解析、旧 npx 缓存清理；本文档更新为 rc.8 版本 |
| 2026-08-21 | 升级 0.1.1-rc.1（当日发布：新增 DeepSeek-V4-Flash-Vision-Exp 视觉模型、修复 Bubblewrap `/proc/<pid>/root` 逃逸、UI 优化）：npm `latest` 标签已指向它，全局原地升级 + npm 11 allow-scripts 补跑 + GUI 重启；本文档更新为 0.1.1-rc.1 版本 |
| 2026-08-24 | 升级 0.1.1-rc.2（2026-08-21 发布，`latest`/`next` 标签均已指向它）：全局原地升级 + npm 11 allow-scripts 补跑 + 项目自检通过；本文档更新为 0.1.1-rc.2 版本。发布内容（[官方 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2)）：体验优化——DeepSeek 适配器优先通过 Files API 上传图像并复用已上传文件；优化图像预处理，按模型要求自动缩放与格式转换。与 rc.1 的多模态/视觉能力相关，对本项目审阅闭环无影响。 |

## 2. 评估背景

本仓库的核心职责分离是：

- Codex 负责任务计划、契约编写、证据判断和代码审阅；
- DSH 只在 Runner 创建的 worktree 中执行具体修改；
- Runner 负责隔离环境、调用 DSH、运行独立检查、执行路径策略并保存审计文件；
- 最终接受、返修、合并、发布或放弃由用户决定。

本次评估回答两个问题：

1. DSH 的 Codex / Claude Code subagent 能力能否用于（或替代）闭环中的 Codex 审阅环节？
2. 该能力还有哪些部分值得本项目借鉴？

## 3. rc.8 事实核查（源码级）

### 3.1 官方发布内容（2026-08-19）

[rc.8 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8) 与本评估相关的变更：

- **Codex 与 Claude Code 子代理可按需安装为 Profile Bundle**；**Codex 新增非交互权限模式和多个命名实例支持**（rc.7 时代 provider 只有 decline/cancel 一种非交互决策，且单实例）。
- **子代理 `reportDelivery` 及时反馈并唤醒父任务**：子代理向父任务报告会唤醒挂起的父激活。
- **本地 `dsh web` 自动打开默认浏览器**：新增提示语 `opening the default browser; pass --no-open to disable`，`--no-open` 关闭；SSH 启动自动跳过浏览器打开。此行为 rc.7 不存在。
- **依赖下载体积改善**（本机升级安装 452 个包，原生模块需 npm 11 `--allow-scripts` 放行）。
- **SQLite 派生索引格式不兼容**。2026-08-21 的 Codex transport probe 确认它属于 `dsh-session-query-sqlite` 全文搜索 read model，不是权威会话日志；base 组合使用 `path: ':memory:'` 与 `openAt: never`，本机没有持久 SQLite 索引。权威会话仍由 `dsh-session-persistence-jsonl` 保存为 `.jsonl.zstd`。
- 多模态（DeepSeek 适配器原生图片请求、`/goal` `/plan` 图文输入）、Windows PTY 持久 PowerShell 等与本项目当前无直接关系。

### 3.2 subagent 机制事实（rc.8 已装包核实）

基于全局安装内 `dsh-subagent`、`dsh-tool-subagent` 及上游 `subagent-codex` / `subagent-claude-code` 包：

| 事实 | 含义 |
| --- | --- |
| provider 是可选包，生产 dsh 不预装 | 需在 profile 按需安装 `@deepseek-ai/dsh-subagent-codex` / `@deepseek-ai/dsh-subagent-claude-code`（rc.8 起作为 Profile Bundle 安装）并在 host 平面挂载；preset 中对应工具行默认 `disabled: true` |
| 需要本机 `codex` / `claude` CLI 及原生认证 | provider 不安装、不登录、不选模型；rc.8 的 Codex provider 支持非交互权限模式与多个命名实例 |
| 每次运行 = 全新进程 + 临时线程/会话 + 单个回合 | 无续跑、无恢复、无进度流、无产品会话持久化 |
| `inheritsParentContext: false` | 子代理只收到独立文本任务 + 父会话 cwd，看不到父对话、persona、工具策略 |
| 只回传最终文本 | 不暴露 reasoning、工具活动、diff、usage；无 output schema、persona、toolFilter、depth 能力 |
| 无人工审批路径 | 非交互：审批请求 decline/cancel（rc.8 Codex 权限模式可配置），未知请求 fail closed |
| 凭据清洗 | subprocess seam 剥除凭据形状的环境变量，子代理环境需显式 `env` 注入 |
| 进程树清理 | 失败/取消时终止整棵进程树并等待退出 |
| 后台模式 | `backgroundMode: one-shot | continuable`；one-shot 的 `run_in_background: true` 返回通用 Job id（Job Panel 管理） |

已装包版本核实：2026-08-21 起 rc.8 / 0.1.1-rc.1、2026-08-24 起 0.1.1-rc.2，`dsh-subagent`、`dsh-tool-subagent`、`dsh-jobs`、`dsh-jobs-local` 均随主版本保持一致；`dsh-subagent-codex` / `dsh-subagent-claude-code` 始终未安装（可选）。`prepareContinuable` / `backgroundMode` 机制跨版本一致。

### 3.3 本机现状（2026-08-21）

- DSH 0.1.1-rc.2 全局安装（`<dsh-executable>`）；headless/web profiles 由 rc.8 重建并随全局路径自动跟随 0.1.1-rc.2；`private archived Contract` 的 `harness.command` 为 `"dsh"`（PATH 解析）；Web GUI 需重启后运行 0.1.1-rc.2；旧 rc.7 npx 缓存目录已清理。
- Codex bundled CLI 存在：`/Applications/ChatGPT.app/Contents/Resources/codex`（`codex-cli 0.148.0-alpha.15`）；Claude CLI 未发现。
- 两个 profile 均未挂载任何 subagent provider，工具行保持 disabled。

### 3.4 Web Host 与会话持久化复核（2026-08-21）

- 本机 Web Host 监听 `127.0.0.1:3080`；`host.describe` 返回 rc.8 Host 状态，`session.list` 能同时列出升级前的 rc.7 会话与升级后的 rc.8/headless 会话。
- unary 控制面是 `POST /api/<method>`；实时下行不是 SSE，而是 `/api/events.mux` 与 `/api/events.host` 两条只下行 WebSocket。普通 GET 返回 HTTP 426 是预期行为。
- `session.create` 支持预分配 `sessionId` 与固定 `cwd`；相同 identity 可恢复持久会话。`session.prompt`、`session.cancel`、`session.history` 和事件流已经具备 M7 MVP 所需的创建、执行、取消、历史补偿与实时观察能力。
- `events.mux` 实测返回 `session/subscribed` baseline。协议的 `since` 在 v1 中仍未实现，重连必须重新获取 history 并按 `seq` 对账，不能假设事件无丢失。
- headless 进程直接写共享 session root，但不会向已经运行的 Web Host 广播 `host/session-added`，所以 UI 可能需要重新载入；这与程序坞无关。通过 Web Host 自身创建会话后，浏览器与 Runner 共用同一事件源，可获得实时可见性。
- 完整探测记录见 `docs/dsh-rc8-web-host-protocol-probe.md`。

## 4. 核心结论：subagent 不用于审阅（版本无关）

### 4.1 审阅的质量由四个环节决定

| 环节 | 内容 | 谁应做 |
| --- | --- | --- |
| ① 标准/提问框架 | 决定"怎么问" | Codex（预注册，先于执行存在） |
| ② prompt 组装 | 把标准渲染成审阅 prompt | Runner（确定性代码 + 人维护的固定模板） |
| ③ 判断 | 读代码下结论 | Codex（真实进程） |
| ④ 结果传递 | 把 findings 交给人工 | Runner（直接捕获原始输出） |

### 4.2 为什么"Codex 写标准 + DSH 发起 subagent 审阅"不可行

该方案下 ③ 判断确实仍是 Codex，但 ② 和 ④ 以及发起时机全部经过 DSH——而 DSH 正是执行者：

- **② prompt 组装**：执行模型决定语气、侧重、补充说明。标准是死的，framing 是活的，执行模型可以引导"确认满足要求"而非"对抗性寻找违规"。
- **发起时机**：谁决定"现在发起审阅"由执行模型控制，它可以选择不发起，或在完成声明中替 Codex 下结论。
- **④ 结果转述**：subagent 只回最终文本，先进 DSH 会话再由 DSH 转给人工；转述环节可淡化、合并甚至丢弃 findings。

结论：该方案比"Codex 直接审阅"**多出三个偏置通道**，判断权在 Codex 但控制权全在 DSH，属于元层面的自我审阅，违反本仓库最核心的职责分离。即使未来模型能力对齐，独立审查者不共享执行者的确认偏差这一结构性理由依然成立，能力差距只是次要理由。

rc.8 的增量（Codex 非交互权限模式、多命名实例、`reportDelivery` 唤醒）改进的是 provider 的审批体验与部署便利，**不改变上述结构**：提问权、发起权、转述权仍由执行模型持有。

### 4.3 正确边界（本仓库必须保持）

```
Codex 写契约（含 acceptanceCriteria 与结构化 review 标准）
  → Runner（确定性代码）用固定模板 prompts/reviewer.md 渲染审阅 prompt
  → Runner 直调 codex CLI 审阅 worktree/patch
  → Runner 校验 findings schema，独立写入 review.json
  → 人工裁决
```

整条链中没有任何模型接触标准、prompt 与结果：Codex 写的标准是数据，Runner 是管道，管道不做判断也不改内容。唯一需要模型判断的地方只有执行（DeepSeek）与审阅（Codex）两处，且互不控制对方。

## 5. 有参考价值的部分（含落地状态）

### 5.1 Skill 写入方式（M5）— 首轮实验完成

- DSH 的 skill 机制（SKILL.md 的 frontmatter `name`/`description` + markdown 正文，放 preset skills 目录或用户 skill root）是 M5"无 Skill vs 有 Skill 配对实验"的载体。
- 已落地：外部 Skill 注入（`skills.root` 外部校验、bundle 拒绝 symlink、SHA-256 记录、`DSH_BUNDLED_SKILL_DIR` 仅 Harness 继承、Harness 篡改 fail closed），相关冒烟与计划文档见 `docs/dsh-native-skill-smoke.md`、`docs/runner-external-skill-smoke.md`、`docs/ant-design-skill-pair-plan.md`。
- 已完成：从相同 baseCommit 执行正式无 Skill（空 `names` + 隔离 patch）与有 Skill 配对实验；B2 的专用 Skill 改善核心实现语义，但两组首轮测试均未一次通过。rc.8 remediation 随后完成 `passed + approved` 闭环。详见 `docs/ant-design-skill-pair-plan.md` 与首轮 scorecard。
- 待办：把通用执行协议是否值得做成 Skill 作为 M9 的通道效率变量单独验证，不能与任务专用 Skill 的效果混为一谈。

**边界**：执行协议可以做成 DSH skill；**审阅模板绝不能做成 DSH skill**——它不发给 DSH，只由 Runner 读取并渲染给 codex CLI。把审阅模板放进 DSH 生态等于把审阅 prompt 的运输交回执行侧。

### 5.2 工程实践 — 已落地

- **凭据清洗** ✅：Runner 的 `requiredChecks` 与外部 `acceptanceChecks` 通过 `createCheckEnvironment()` 白名单只继承非敏感环境变量（PATH/HOME/locale/临时目录/包管理器路径），不继承 `*_API_KEY`、Token、DSH session 或 SSH agent；Harness 自身保留 DSH 正常认证所需环境。
- **进程树清理** ✅：`runCommand` 使用 `detached` 独立进程组，配合 SIGTERM→SIGKILL 分级超时，Harness、checks 与 reviewer CLI 超时终止整个派生进程组。
- **Job 语义**：`id/status/detail/start/finish/kill/wait` 可作为命名参考，但 `dsh-jobs` 明确是进程内、非持久 registry，不能作为 Runner 的跨进程权威状态。M7 应以 `sessionId`、session event `seq`、`turn/end`、Host running 状态和 Runner 自身 artifacts 为准。

### 5.3 Runner 直调 Codex 自动化审阅 — 已实现（M4）

- 已落地：`codex-review` / `record-review` 命令、`prompts/reviewer.md` 固定审阅协议（不发送给 DSH）、`contracts/review.schema.json`（`approved / changes-requested / blocked` 状态语义、finding 唯一 ID/位置/证据/最小修复/解决状态）、`src/review.ts` 与 `src/reviewer/codex-cli.ts`（固定 never approval、read-only sandbox、ephemeral、忽略用户 config/rules、structured output、JSONL 审计）。
- 探测完成（`docs/codex-cli-protocol-probe.md`）：非交互 structured output 可生成候选 JSON 并通过 Runner 二次校验；`ephemeral` 仍读取 state DB，最小探测约 15,963 input tokens。
- 已完成真实项目 smoke（`docs/codex-review-adapter-smoke.md`）及 Ant Design Pro rc.8 canonical review；普通 `run` 不自动触发 reviewer，已有 `review.json` 不被覆盖。

## 6. 明确不采用的部分

| 能力 | 不采用原因 |
| --- | --- |
| `subagent_codex` / `subagent_claude_code` 工具 | 用于审阅会把提问权、发起权、转述权交回执行模型；用于执行侧当前无需求（执行就是单一 DSH headless 会话） |
| 基于 subagent 的返修对话 | provider 为 one-shot 无续跑，与 lineage 返修链（父子契约、findings 继承、最多两轮）模型不兼容 |
| 无人值守执行 | 无人工审批路径 + 只回文本 + 无 output schema，结构化证据完全缺失 |
| 审阅模板做成 DSH skill | 违反 4.3 的边界 |

rc.8 对 provider 的增强（非交互权限模式、多命名实例、按需 Bundle 安装）不改变以上任何一条。

## 7. 建议清单（状态）

1. 保持审阅为"Codex 判断 + Runner 编排 + 人工裁决"——**已实现**（`codex-review` 命令 + `prompts/reviewer.md` + review schema），继续维护不放松职责分离。
2. M5：从相同 baseCommit 完成无 Skill / 有 Skill 配对实验——**首轮完成**；通用执行协议 Skill 的效率收益移至 M9 验证。
3. 凭据清洗与进程组清理——**已完成** ✅。
4. codex CLI 真实项目 smoke（`docs/codex-review-adapter-smoke.md`）——**已完成** ✅；rc.8 Ant Design remediation review 也已 `approved`。
5. 独立 review-only 会话（Web UI 内审阅可见性）——**不优先**，先评估偏置风险与证据强度损失。
6. 升级收尾：rc.8 真实基线冒烟已由 Ant Design remediation 覆盖；会话持久化与 Web Host 控制面复核已完成；SQLite 变化只影响可重建的全文搜索派生索引，不构成 session migration blocker。0.1.1-rc.1 升级已完成；0.1.1-rc.2 已于 2026-08-24 升级（全局安装 + allow-scripts + 项目自检通过），GUI 需重启后使用，可选做一次真实基线冒烟确认。
7. 原遗留 P1 已处理：`RunReport.status` 已统一为 `passed | failed | blocked`，并由 `contracts/result.schema.json` 约束；编排仓库尚无初始 commit。

## 8. 附注

- 本文档为独立评估记录，不修改 `ROADMAP.md` 的里程碑状态。
- 遗留问题仅剩编排仓库无初始 commit；是否建立初始 commit 仍由用户决定。
- 重新评估触发条件：DSH 后续版本改变 subagent provider 的上下文继承、结构化输出或审批语义；或 DSH 提供模型无关的审阅编排能力（审阅发起、prompt 组装与结果传递脱离执行模型控制）。
