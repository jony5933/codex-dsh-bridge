# Codex → DSH Web Host Bridge 路线图

更新日期：2026-08-24

## 目标

为 Codex 提供一个标准化、实时可见、正确分组的 DSH Web Host 通道，并在需要时附加安全控制。Codex 负责计划与 review，DSH 负责执行；Bridge 负责 `Workspace` 解析、session 生命周期、实时事件和结构化 evidence。既有 Runner 收口为可选安全策略层。

## 当前定位

```text
任务需求
  → Codex 生成计划与任务说明
  → Bridge 按项目路径解析 DSH Workspace
  → Web Host 创建正确分组的 session
  → DSH Web UI 实时显示执行进度
  → Bridge 返回终止状态与 evidence
  → Codex 审阅代码变化
  → 人工决定接受、返修或放弃
```

日常推荐入口为轻量 `web-run`（`web-direct`）；需要隔离、边界、独立检查或审计时显式使用 guarded `run`。guarded Runner 继续禁止自动提交、合并、推送或删除 worktree。两条命令职责独立，不把 Web session evidence 填成 process evidence。

## 里程碑

| 阶段 | 状态 | 交付物 / 完成条件 |
| --- | --- | --- |
| M0：安全 Runner 骨架 | ✅ 已完成 | JSON Contract、schema 校验、隔离 worktree、路径边界检查、独立 checks、patch 和 JSON artifacts |
| M1：真实 DSH 基线 | ✅ 已完成 | 在 `<validation-repository>` 上完成无 Skill 的逻辑任务；DSH 退出 0、5/5 测试通过、无越界文件 |
| M2：执行可观察性与进程安全 | ✅ 已完成 | 实时输出、artifacts、checks 凭据环境白名单和 POSIX timeout 进程组清理均有自动测试 |
| M3：基线任务集 | ✅ 已完成 | A1、A2 v2、A3 三个无 Skill 基线均完成；A2 v2 与 A3 通过外部 acceptance 和真实结构化 review 获得 `approved` |
| M4：Codex 审阅与返修循环 | ✅ 基础闭环完成 | fake CLI 故障矩阵与真实只读 adapter smoke 均通过；自动返修编排仍保持关闭，由用户决定是否返修 |
| M5：Skill 对照实验 | ✅ 首轮完成 | rc.7 B1/B2 受控配对已归档；rc.8 remediation 完成 12/12 tests、TypeScript、build 与 Codex `approved`，并形成首轮 scorecard |
| M6：异常与对抗验证 | ✅ 已完成（5/5） | 禁止路径、lockfile、冲突 acceptance、baseline 阻断与 commit/push 对抗均有自动 fail-closed 证据 |
| M7：Web Host Bridge MVP | ✅ 7/7 已完成 | 已完成 transport/client/coordinator、Workspace 分组、断线恢复、双模式 evidence、真实 Host 与 UI 无刷新可见性 smoke；`web-direct` 成为推荐入口 |
| M8：Bridge 交付与安装 | ✅ 6/6，GitHub public | MIT、私有 evidence 归档、脱敏 snapshot、release 文档、rc.2 probe 与 tarball 安装均已验证；干净初始历史已推送 GitHub，npm 尚未发布 |
| M9：通道效率基准 | ✅ 三轮完成 | A3 完成三轮交替顺序配对；两组均 3/3 通过并获 `approved`，已汇总 Token、耗时、patch 方差与安全/审计收益 |

## 已验证证据

### 真实运行 1：基础闭环

- Run ID：`daily-window-midnight-20260817033729874`
- DSH 执行时间：24.472 秒
- 结果：通过；目标测试 5/5；无路径越界
- Codex review：无可执行问题
- Artifacts：`<private-artifact-root>/.artifacts/daily-window-midnight-20260817033729874`

### 真实运行 2：实时输出复验

- Run ID：`daily-window-midnight-20260817055850462`
- DSH 执行时间：28.383 秒
- 结果：通过；目标测试 5/5；无路径越界
- 已在运行期间显示 `preparing → harness → checking → verification → complete`
- Artifacts：`<private-artifact-root>/.artifacts/daily-window-midnight-20260817055850462`

### Runner 自身验证

- `pnpm run check` 通过
- 当前 26 项测试通过
- 覆盖 Contract 默认值与拒绝、lineage 继承、路径边界、worktree 隔离、越界失败、独立 acceptance checks 和 stdout/stderr 流式回调

### A2：跨文件校验与返修闭环

- 首次运行：`access-request-layers-20260817075134567`，14/14 测试通过，Codex review 发现 disabled 绕过窗口顺序校验的 P2。
- 第 1 轮返修：`access-request-layers-repair-1-20260817075523022`，24/24 测试通过，Codex review 发现 Controller 误吞原生 `TypeError/RangeError` 的 P2。
- 第 2 轮返修：`access-request-layers-repair-2-20260817080243622`，19/19 测试通过，但 Contract 审计发现响应结构偏离初始验收条件。
- 三轮均无路径越界，DSH 总执行时间 235.058 秒。
- 最终结果：`changes-requested`；达到两轮返修上限，不合并，不继续自动返修。
- 评分记录：`docs/scorecards/A2-access-request-layers.md`。

### A2 v2：固定 Contract 后的重新验证

- 新根 Contract：`private archived Contract`；沿用 base commit `9b63808f6e5c3dfc53cee01c20898bd73d78d163`，不继承旧返修链。
- Run ID：`access-request-layers-v2-20260820072713067`；DSH 退出 0，56.461 秒，未超时。
- Runner：`npm test` 25/25 通过；外部 `a2-stable-contract` 通过；只改四个 `allowedPaths`，无路径违规，目标仓库主工作目录保持不变。
- 真实 Codex review adapter：execution `passed`，62.319 秒，最终 `approved`，无 findings 或 blockers。
- 审阅期间 WebSocket 首次连接出现一次 TLS EOF，但 CLI 正常完成并生成有效 `turn.completed`、candidate 和 canonical `review.json`；failure reasons 为空。
- 结论：无需返修。旧 A2 暴露的 disabled 校验、原生异常误分类和响应结构漂移均已由根 Contract 与外部 acceptance 固定。
- Artifacts：`<private-artifact-root>/.artifacts/access-request-layers-v2-20260820072713067`
- 评分记录：`docs/scorecards/A2-access-request-layers-v2-20260820072713067.md`。

### A3：行为保持重构

- Contract：`private archived Contract`；base commit 为 `9b63808f6e5c3dfc53cee01c20898bd73d78d163`，只允许修改 `src/daily-window.js`。
- Run ID：`daily-window-validation-refactor-20260820073423927`；DSH 退出 0，20.525 秒，未超时。
- Runner：`npm test` 4/4 通过；外部 `a3-daily-window-behavior` 通过；只修改一个允许文件，无路径违规，目标仓库主工作目录保持不变。
- Patch 仅把三次直接参数校验替换为有序声明式集合与单一迭代，public API、错误优先级/消息和窗口边界语义保持不变。
- 真实 Codex review adapter：execution `passed`，68.071 秒，最终 `approved`，无 findings 或 blockers。
- stderr 有一次 model 列表刷新子进程超时告警，但审阅回合完整、exit 0、failure reasons 为空，candidate 与 canonical review 一致。
- Artifacts：`<private-artifact-root>/.artifacts/daily-window-validation-refactor-20260820073423927`
- 评分记录：`docs/scorecards/A3-daily-window-validation-refactor-20260820073423927.md`。

### DSH rc.7 原生 Skill 加载 smoke

- `headless --dump-config` 确认实际挂载 Skill registry、filesystem provider 和模型侧 loader；默认项目根支持 `.dsh/skills` 与 `.agents/skills`。
- 独立 fixture 中，显式 `/runner-channel-smoke` 与仅按 description 自动路由的两个新 session 均返回只存在于 Skill 正文的固定成功 JSON。
- 无 Skill 负对照报告 loader unknown，没有产出成功结果，证明 catalog 按项目根隔离。
- headless session artifact 只保留 header，缺少独立 tool-event 和 usage 记录；当前证据不能描述为完整调用审计。
- `read-only` run 仍能读取相邻 fixture，说明它不是 workspace 读取隔离；Skill marker 不得承载秘密。
- 详细记录：`docs/dsh-native-skill-smoke.md`。

### Runner 外部 Skill 注入 smoke

- 新增 `skills.root/names/invocation` Contract、`src/skills.ts` 和生成的 `{skillPatch}` 通道；`includeDefaultRoots: false` 保证 catalog 只包含 artifact 投影。
- B1 可用 `skills.names: []` 获得隔离空 catalog；B2 只增加指定外部 bundle，避免本机默认 Skill 污染实验变量。
- Runner 校验 YAML frontmatter、外部 canonical path 和 symlink，对 patch 与全部 bundle 文件计算 SHA-256，并在 Harness 后重新验证；篡改会 fail closed。
- 最终自动验证：`pnpm run check` 通过，31/31 tests 通过。
- 真实 Run ID：`runner-external-skill-smoke-20260820082342502`；DSH 14.921 秒、required check 和外部 acceptance 均通过，只新增允许的证明文件，无路径违规。
- `result.json.skills` 为 `isolated: true`、`verified: true`、`violations: []`；目标主工作目录保持不变。
- Artifacts：`<private-artifact-root>/.artifacts/runner-external-skill-smoke-20260820082342502`
- 详细记录：`docs/runner-external-skill-smoke.md`。

### Ant Design Pro 配对基线

- 官方目标：`ant-design/ant-design-pro` v6.0.3；固定 `baseCommit` 为 `adfd44085738ca953573a13322c1ba84aca8b9e3`。
- 独立本地目标：`<ant-design-validation-repository>`；Node 24.19.0。
- untouched baseline：页面测试 5/5、全量 Vitest 54/54、`tsc --noEmit` 和 production build 全部通过；目标源码无 tracked diff。
- `npm ci` 共安装 2072 个 packages，约耗时 6 分钟；后续 B1/B2 在 Harness 完成后由独立 acceptance 临时复用固定依赖，不让 DSH 安装依赖，也不把链接暴露在执行阶段。
- 实验范围锁定 `src/pages/table-list/index.tsx` 与对应测试；B1 使用隔离空 catalog，B2 只注入 `ant-design-pro-table-states`。
- 实验设计：`docs/ant-design-skill-pair-plan.md`。

### Ant Design Pro 首轮 B1/B2

- B1 Run ID：`ant-design-table-states-b1-20260820091357846`；空 native Skill catalog，DSH 622.195 秒，边界通过，独立验收失败。
- B1 把 request rejection 返回为 `success: true`，且 Empty test 使用歧义文本查询；Codex review 为 `changes-requested`，包含 P1 实现与 P2 测试 findings。
- B2 Run ID：`ant-design-table-states-b2-20260820092447283`；显式 Skill 投影完整且 verified，DSH 775.234 秒，边界通过。
- B2 隐藏行为验收 2/2 通过，避免了 B1 的错误响应语义；但自身两个 Empty tests 同样因 `getByText('No data')` 匹配 SVG title 与 description 而失败，Codex review 为单一 P1 `changes-requested`。
- 暂时结论：Skill 改善核心实现正确性，但没有避免测试定位器错误，且本次耗时更长；必须完成 B2 最小返修后再评估净收益。
- 官方目标树包含两组共有的 `.claude/skills/antd/SKILL.md`；Runner 证明的是 B1 DSH native catalog 为空，不把该组描述为文件系统中完全无 Skill。
- 详细结果与明日恢复入口：`docs/ant-design-skill-pair-plan.md`。
- B1/B2 的完整首轮 artifacts 已复制到 `docs/validation-evidence-summary.md`，避免 `/private/tmp` 清理导致证据丢失。

### Ant Design Pro rc.8 remediation 闭环

- Contract：`private archived Contract`；这是 rc.8 升级后的独立 remediation root，不改写 rc.7 原始配对证据。
- Canonical Run ID：`ant-design-table-states-b2-rc8-20260821044006042`；DSH exit 0，执行 723.762 秒，只修改两个允许文件，Skill bundle verified 且无边界违规。
- 独立验收使用 worktree 内 APFS clone-on-write 依赖副本，解决 Umi/Utoopack 拒绝外部 symlink 的问题；12/12 tests、TypeScript、production build 和 `git diff --check` 全部通过。
- Codex review：`approved`，无 findings 或 blockers；耗时 96.714 秒。该结果证明闭环可完成，但因 DSH 版本与 remediation prompt 均变化，不作为 B1/B2 的纯 Skill 因果样本。
- 持久 artifacts：`docs/validation-evidence-summary.md`；评分记录：`docs/scorecards/B1-B2-ant-design-skill-pair.md`。

### Contract lineage 防漂移

- 新增 `contracts/repair.schema.json`：返修 overlay 只能包含新的 `taskId`、父 Contract、连续轮次和结构化 findings。
- Runner 自动继承原始 Contract 的 objective、baseCommit、路径边界、acceptance criteria、required checks、Harness 与 execution 配置，返修不能覆盖这些字段。
- 强制父子轮次连续、最多两轮，并拒绝循环引用；`result.json` 和 DSH prompt 均记录完整 lineage history。
- `pnpm run check` 通过；lineage 相关测试覆盖继承、篡改拒绝、跳轮、循环引用、第三轮拒绝及 Runner 审计输出。

### M6 对抗验证：路径与 lockfile

- 既有 Runner 测试证明：Harness 即使 exit 0，只要修改明确禁止的 `package.json`，run 仍为 `failed`，并记录 `explicitly-forbidden`。
- 新增意外 lockfile 场景：allowlist 故意放宽为 `**`，Harness 同时生成允许的 `src/result.txt` 与禁止的 `package-lock.json`，required check 仍成功。
- Runner 最终只把 `src/result.txt` 列为 allowed，明确把 `package-lock.json` 列为 violation；`result.json` 与 patch 均保留证据，目标主仓库无 lockfile。
- 自动验证升至 34/34 tests。详细矩阵见 `docs/m6-adversarial-validation.md`。

### M6 对抗验证：冲突 acceptance

- 新增 Contract invariant：`acceptanceChecks[].id` 必须全局唯一；同一 identity 绑定多个检查定义会使 artifact 与结果归属产生歧义。
- 冲突在 `loadContract()` 阶段直接拒绝，发生在 Git repository 解析、worktree 创建和 Harness 启动之前。
- 单元测试验证错误信息稳定；Runner 级测试使用 Harness marker 证明执行进程未启动，目标源码也没有写入。
- 自然语言 `acceptanceCriteria` 的语义矛盾不做关键词猜测；无法静态证明的冲突留给结构化 Contract 扩展或 run 级 `blocked` 语义。

### M6 对抗验证：baseline 预存失败

- Task Contract 新增可选 `baselineChecks`，与修改后运行的 `requiredChecks` 明确分工；repair overlay 不可替换并自动继承。
- Runner 在隔离 worktree 中先运行 baseline；失败时生成统一 `result.json`，状态为 `blocked`，随后停止，不生成代理 patch。
- `contracts/result.schema.json` 强制 blocked 报告的 Harness、Skill、Git policy 和 patch artifact 为 `null`，要求至少一个 blocker，并禁止混用 failure reasons。
- Runner 级测试证明 fake Harness marker 不存在、目标仓库没有代理输出，result 保存原命令和 exit code 1；schema 状态转换测试拒绝 blocked 携带 patch 或 non-blocked 携带 blockers。
- worktree 创建事件已移动到真实创建完成时发送，因此被 baseline 阻断的事件序列仍准确可观察。
- 当前完整自动验证为 42/42 tests。

### M6 对抗验证：诱导 commit/push

- Runner 为 Harness 生成独立 Git policy wrapper 并置于 PATH 首位；标准 `git commit` 与 `git push` 返回 126，同时把完整参数写入 worktree 外的 JSONL audit。
- Harness 后重新校验 wrapper hash、HEAD 与全部 refs；使用 Git 绝对路径绕过 wrapper 的 commit 会被 HEAD/ref 快照捕获。
- 两个对抗测试中 Harness exit 0、required check 通过、路径边界也合法，但 Runner 均因 Git policy violation 将 run 判为 `failed`；主仓库当前分支保持 baseCommit。
- `result.json.gitPolicy` 保存 wrapper/hash、blocked commands、starting/final HEAD、ref changes 和 violations，并进入 Codex reviewer evidence。
- 自动验证升至 37/37 tests。命令 wrapper 不是 OS/network sandbox，无法保证撤销已发生的外部 push；产品化隔离仍需容器或网络策略。

### 独立 acceptance checks

- 根 Contract 可声明外部 `acceptanceChecks`，repair overlay 不可替换并会沿 lineage 继承。
- 检查脚本相对根 Contract 解析，必须位于目标仓库与执行 worktree 外；Runner 不把脚本路径或源码发送给 DSH。
- `result.json` 单独记录检查命令、退出码、输出和耗时；任何独立验收失败都会让 run 失败。
- 该阶段 `pnpm run check` 通过，13 项测试包含“项目内 required check 通过但外部验收发现行为漂移”及“拒绝仓库内检查脚本”。

### DSH rc.8 参考性复核

- 本地安装确认是 `@deepseek-ai/dsh@0.1.0-rc.8`；subagent 审阅不纳入闭环，Codex review 仍由执行侧之外的 Runner/Codex 发起并保存原始结果。
- rc.8 的非交互权限模式、多命名 Codex 实例与 `reportDelivery` 改善 provider/Job 体验，但不改变本项目职责分离结论。
- Codex App 当前带有 `codex-cli 0.148.0-alpha.15`；Runner 直调 review 具备实验条件，但需先验证非交互结构化输出和版本兼容，失败时必须 fail closed。
- 已借鉴凭据清洗：`requiredChecks` 与 `acceptanceChecks` 使用非敏感环境变量白名单；完整 `pnpm run check` 通过。
- rc.7 Job 语义纳入 M7 设计；DSH 原生 Skill 加载方式纳入 M5 实验准备。详细复核见 `docs/dsh-subagent-assessment.md`。

### 结构化 Codex review artifact

- 新增 `contracts/review.schema.json`、固定 `prompts/reviewer.md` 和 `src/review.ts`；审阅结果统一为 `approved / changes-requested / blocked`。
- finding 强制记录唯一 ID、severity、文件位置、evidence、minimalFix 和 resolution；状态与 Runner report、open findings、blockers 必须语义一致。
- review candidate 和最终 `review.json` 必须位于执行 worktree 外，并与 `runId`、`taskId` 绑定；`record-review` CLI 只做确定性校验和落盘。
- `pnpm run check` 通过，18 项测试中包含 4 项 review artifact 测试。

### Bundled Codex CLI 协议探测

- 本机 `codex-cli 0.148.0-alpha.15` 的 `exec` / `exec review` 支持 `--ephemeral`、`--output-schema`、`--json` 和 `--output-last-message`。
- 错误参数顺序 exit 2、缺失 schema exit 1、不兼容 structured-output schema exit 1；均未产生可接受 review，符合 fail-closed 要求。
- 修正后的 `review.schema.json` 探测成功，JSONL lifecycle 完整，final candidate 通过 `record-review` 二次校验。
- 成功 probe 约 21.3 秒，usage 为 15,963 input / 70 output tokens；`ephemeral` 仍读取本地 state DB 并产生 warning，不得描述为完全无状态。
- POSIX timeout 已改为终止整个 process group；自动测试证明派生 grandchild 不会残留。完整记录见 `docs/codex-cli-protocol-probe.md`。

### Codex review adapter

- 新增 `src/reviewer/codex-cli.ts`；普通 Runner `run` 不自动审阅，只有显式 `codex-review <result.json> <codex-command>` 才启用。
- 固定参数顺序、stdin prompt、never approval、read-only、ephemeral、忽略用户 config/rules、output schema、JSONL 和 final candidate 路径。
- reviewer 只继承非敏感环境白名单和可选 `CODEX_HOME` 路径；API Key、DeepSeek Key 和 Token 不传给子进程。
- 每次 attempt 保存 prompt、stdout JSONL、stderr、candidate、execution report、usage 和 failure reasons；canonical `review.json` 不允许覆盖。
- fake CLI 覆盖 disabled、成功、非零退出、timeout、malformed JSONL、缺少 `turn.completed` 和 invalid candidate；`pnpm run check` 26 项全部通过。

### Codex review adapter 真实 smoke

- 专用无 commit Git fixture 的项目内 tests 3/3 通过，但实现故意让 `disabled: true` 绕过窗口校验，并缺少对应回归测试。
- 真实 adapter execution `passed`，review 为 `changes-requested`，准确产生 P1 实现 finding 和 P2 测试 finding。
- Duration 58,595 ms；usage 29,277 input、13,056 cached input、735 output、112 reasoning output tokens；failure reasons 为空，stderr 为 0 字节。
- smoke 前后源码 SHA-256、Git status 和 tests 完全一致；JSONL 中唯一 command 为只读文件检查；candidate 与 canonical review 语义一致。
- 详细证据见 `docs/codex-review-adapter-smoke.md`。

### 通道效率基准：A3 首轮配对

- 直接组与 Runner 组固定同一 base commit、2,583-byte prompt、`deepseek-v4-flash`、检查和 Codex reviewer；prompt SHA-256 完全一致。
- 两组均通过 4/4 项目测试、外部 acceptance 和路径核对，并获得 Codex `approved`、0 findings。
- 直接组 DSH 22.933 秒、6 次模型响应；Runner 组 DSH 39.271 秒、7 次模型响应。直接实现为 `+9/-3`，Runner 实现为 `+14/-3`。
- 新增 `dsh-session-metrics`，可从 rc.8 concatenated Zstandard session 精确汇总 usage。
- 新增独立 `direct-evidence.schema.json` 和 evidence normalization；Codex adapter 会校验两类 evidence，review prompt 使用中性的 channel/controls 表述。完整自动验证升至 47/47 tests。
- 首轮数据不支持因果结论：需要再完成两轮并交替运行顺序。Runner 已证明的优势是自动隔离、Git policy、独立检查、边界核验与标准 artifacts，而非当前样本中的速度或 Token。
- 持久证据：`docs/validation-evidence-summary.md`；评分记录：`docs/scorecards/A3-channel-benchmark-20260821.md`。

### 通道效率基准：A3 第 2 轮

- 反转为 direct → Runner 顺序，继续固定同一 base commit、prompt hash、模型、检查和 reviewer。
- 两组再次全部通过并获得 `approved`、0 findings；direct 总模型进程 54.770 秒，Runner 为 55.273 秒，仅差 0.503 秒。
- direct DSH 为 5 次调用、9,492 input tokens、`+9/-3`；Runner 为 6 次调用、10,020 input tokens、`+8/-3`，Git policy 与路径边界 verified。
- 新 direct schema 与中性 reviewer prompt 经真实模型验证：review summary 不再把 direct 的手动检查误称为 Runner controls。
- 两轮通过率均为 2/2；速度和 Token 仍不能形成因果结论，需完成第 3 轮后再汇总。

### 通道效率基准：A3 第 3 轮与最终结论

- 恢复 Runner → direct 顺序；两组继续固定相同 base commit、2,583-byte prompt、模型、检查和 reviewer，均通过并获得 `approved`、0 findings。
- 第 3 轮 direct DSH 20.244 秒、6 次调用、10,072 input tokens；Runner DSH 23.090 秒、7 次调用、10,207 input tokens。
- 三轮通过率均为 3/3；DSH duration 中位数 direct 20.244 秒、Runner 23.090 秒，总模型进程中位数分别为 54.770 秒和 66.824 秒。
- direct 三轮产生 2 个不同 patch，Runner 产生 3 个；全部保持行为。当前小任务没有显示 Runner 的速度或 DSH Token 优势。
- Runner 的确定性价值是把隔离 worktree、Git policy、独立 checks、边界核验和 schema evidence 固化为 fail-closed 通道。主 Codex 手工编排 direct 的成本未被计量，不能据此宣称完整端到端 direct 更省。
- M9 当前阶段完成。该结果支持将日常目标入口调整为 `web-direct`，并把 Runner 控制保留给显式选择的 `web-guarded`。

## 下一批工作

M7 拆分为七个可独立验收的阶段：

1. ✅ 协议探测：确认 rc.8 HTTP RPC、双 WebSocket、session 终止证据和失败语义。
2. ✅ 严格 client：完成 loopback、envelope、rpcId、stream frame 和最小 RPC allowlist 校验。
3. ✅ session coordinator：完成 prompt 单次发送、seq/turn/running/history 对账和 fake Host 异常矩阵。
4. ✅ 正确分组：allowlist 只增加 `workspace.list/create`；`WorkspaceResolver` 按 canonical project path 精确匹配或幂等创建，以 `workspaceId + sessionId` 创建 session，并在 prompt 前通过 `workspace.list` 核验归属。
5. ✅ 恢复：正常 downlink close 后重新建立双流；分页读取完整 history、补偿遗漏事件并用 `session.list` 对账 running 状态。协议错误、history gap、超出重连次数或恢复失败继续 fail closed，prompt 不会重发。
6. ✅ 双模式 transport：实现 `WebHostTransport` 与 transport 专属 evidence；`web-direct` 保持轻量，`web-guarded` 把可复用的事后控制标为调用方责任，均不伪造 process exit code。
7. ✅ 真实验收：真实 Web Host session 已正确创建、分组、完成并通过 history/目标仓库核验；用户确认已打开的 DSH UI 无需刷新即显示了正确 Workspace 下的新 session。

M7 已通过，`web-direct` 现为推荐入口，`web-guarded` 作为显式安全选项；`headless` 保留为诊断或明确选择，并且只能在 prompt 尚未发出时切换。M8 下一步只处理 Bridge 交付、配置和持久 evidence，不扩建重复 Git Review UI；Cordis Git Review 继续暂停，除非真实使用证明存在独立需求。

M8 拆分为六个发布前阶段：

1. ✅ **产品与分发边界**：GitHub/npm 发布 Bridge 核心；主要面向 DSH/Cordis 生态，Codex plugin 只做可选薄 companion，不复制 transport。详见 `docs/distribution-strategy.md`。
2. ✅ 配置与持久 evidence：支持 endpoint、timeout、artifact root 的显式配置；默认保存到 `~/.dsh-bridge/runs`，不依赖 `/private/tmp` 或 shell redirect。artifact root 在 prompt 前完成 canonical path、项目外边界和目录预检，evidence 以不覆盖既有文件的方式发布。
3. ✅ **运行索引**：按 project、Workspace、session、状态和时间保存本地索引，并提供只读查询。
4. ✅ **兼容探测**：启动前核对 DSH version 与必需 RPC/capability；未知或不兼容版本 fail closed，并保存 probe evidence。
5. ✅ **安装与包边界**：beta 保持单包 `codex-dsh-bridge`，主要 binary 为 `codex-dsh`，保留 `deepseek-loop` 兼容 alias；DSH 作为独立前置条件。安装、升级、卸载和隔离 tarball smoke 已通过，详见 `docs/package-installation.md`。
6. ✅ **GitHub/npm beta release-ready**：MIT、repository metadata、安全说明、贡献指南、release checklist、release notes、Codex companion 安装说明、私有 evidence 归档与干净公开 snapshot 均已完成。远端创建、commit/push、tag 和 npm publish 仍等待维护者逐项授权；真实 beta 稳定后再生成 Codex plugin scaffold。

M7 当前协议依据见 `docs/dsh-rc8-web-host-protocol-probe.md`，只读机器证据见 `docs/validation-evidence-summary.md`。

### M7 transport 抽象

- 新增内部 `HarnessTransport` request/output 契约，Runner 可注入 transport，但默认选择保持为 `HeadlessTransport`。
- `HeadlessTransport` 沿用原有参数 placeholder、worktree cwd、timeout、环境和 stdout/stderr 回调，不改变现有 Contract 或 `result.json`。
- 新增独立回归测试验证中文 prompt、含空格 Skill patch、环境变量、双流回调和 command evidence；完整自动验证为 48/48 tests。

### M7 Web Host client 协议层

- 新增 rc.8 adapter，固定 `client-request / server-response / server-request` envelope、`rpcId` 回显、RPC error 与 HTTP failure 的 fail-closed 语义。
- endpoint 只接受显式 loopback origin；默认 `http://127.0.0.1:3080`，拒绝 LAN host、非 HTTP(S)、credentials、path、query 和 hash。
- RPC allowlist 仅包含 `host.describe`、`session.list/create/history/prompt/cancel` 与 `workspace.list/create`；不暴露 settings、credentials、filesystem、Workspace/session 删除或 agent-preset 管理面。
- 双 WebSocket 下行校验 stream 专属 frame type，且要求 envelope `method === payload.type`；malformed、binary 与跨 stream frame 会关闭连接并报错。
- 自动验证为 55/55 tests；新 client 的只读 live smoke 已通过 `host.describe` 和双 WebSocket 握手，未创建 session 或发送 prompt。
- 机器证据：`docs/validation-evidence-summary.md`。

### M7 session coordinator 与 Workspace 分组

- fake Host 已覆盖严格调用顺序：双流与 `host.describe` readiness、canonical Workspace 解析、预分配 `workspaceId + sessionId`、归属核验、history baseline、单次 prompt、最终 history。
- 正常完成必须同时观察目标 turn 的 `turn/end`、`running:true → false`，并确认 baseline 到 terminal 的 history seq 连续且 reason 一致。
- live seq gap 会 fail closed；prompt 已被接受后只尝试 `session.cancel`，不允许 fallback 或第二次 prompt。
- terminal reason 只有 `completed` 归一化为完成；`aborted/blocked/error/max-tokens/interrupted` 统一归一化为失败。
- fake Host 异常矩阵已覆盖 approval/question、agent error、downlink disconnect、全程 timeout、cancel settle 和 cancel-unconfirmed。
- `session.prompt` 一旦发出即禁止 fallback；即使接受响应丢失也按“可能已执行”处理，防止双写。
- 新增 `src/harness/web-host/workspace.ts`，严格解析 rc.8 Workspace view，拒绝相同 canonical path 的重复 Workspace、create path 不一致和 session 未 attach。
- coordinator 支持可限制次数的双流重连；恢复时完整分页读取 history、忽略重复 seq、拒绝 gap，并查询 `session.list` 对账最终 running 状态。setup 阶段断线不会发送 prompt，恢复也不会重发 prompt。
- 新增双模式 `WebHostTransport`：成功 evidence 保存 Host、Workspace、session、terminal seq/reason 和 reconnect 次数；失败保存结构化错误，approval/question 归一化为 `blocked`，其余协议失败归一化为 `failed`。
- Web evidence 不包含 `exitCode` 或 `timedOut`。`web-guarded` 明确把 Git ref audit、checks、boundary 和 artifacts 标为 `caller-required`；rc.8 不支持的 process environment、Git wrapper 与 Skill patch 标为 `false`，不得误报已启用。
- 自动验证为 77/77 tests；Web Host 保持为独立 transport，不接入以 process result 为核心的 Runner `run`。真实 DSH session mutation 已由下述 smoke 验证。

### M7 真实 Web Host smoke

- Bridge baseline commit：`6132189`；目标仓库为 `<validation-repository>`，固定 commit `9b63808f6e5c3dfc53cee01c20898bd73d78d163`。
- 真实 `web-direct` session `53ee4719-cc6b-43e8-8319-1e8cf80c5395` 通过本机 `127.0.0.1:3080` 创建；Host 使用 `deepseek-official / deepseek-v4-flash`。
- 新建 Workspace `run a`，canonical path 为目标路径，且 `sessionIds` 精确包含本次 session；未落入 `Ungrouped`。
- prompt 被接受一次，live 状态观察到 running，最终 `turn/end` 为 `completed`、terminal seq 为 478、最终 running 为 false；完整 history 共 479 个 events，并包含 prompt 与 `M7_WEB_HOST_SMOKE_OK`。
- smoke 前后目标 HEAD 和 Git status 不变；只有运行前已存在的 `?? .DS_Store`，没有 tracked diff。
- 用户确认已打开的 DSH UI 无需刷新即出现 `run a` Workspace 下的新 session，补齐实时可见性的人工 UI 证据；M7 因此达到 7/7。
- 机器证据：`docs/validation-evidence-summary.md`。

### M7 推荐入口

- CLI 新增 `web-run <project-path> <prompt.md>`，固定使用 `web-direct` 和本机 `127.0.0.1:3080`；命令输出原生 Web evidence，并对 `failed / blocked` 返回非零状态。
- `run <task-contract.json>` 继续显式保留既有 `HeadlessTransport`，用于需要 Git wrapper、隔离 Skill catalog 或完整 Runner controls 的任务。
- 不实现 prompt 接受后的自动 fallback；Web Host 与 headless 不会对同一任务双写。

### M8 配置与持久 evidence

- `web-run` 新增 `--endpoint`、`--timeout-ms` 与 `--artifact-root`；默认分别为 `http://127.0.0.1:3080`、30 分钟和 `~/.dsh-bridge/runs`。
- endpoint 继续由严格 client 限制为 loopback origin；timeout 限制为 1 毫秒至 24 小时，并拒绝 unknown、duplicate 或缺值参数。
- artifact root 必须位于目标项目之外，且会解析既有 symlink ancestor；边界与目录预检发生在创建 transport 和发送 prompt 之前。
- evidence 默认保存为 `<artifactRoot>/<YYYY-MM-DD>/<sessionId>/evidence.json`，文件内和 stdout 都包含 canonical `evidencePath`；临时文件使用 `0600`，最终通过同目录 hard link 原子发布且不覆盖既有 evidence。
- 每次运行同时保存 `<artifactRoot>/index/<YYYY-MM-DD>/<sessionId>.json` 不可变索引 record，包含 canonical project、Workspace（无法确认时为 `null`）、session、mode、状态、起止时间和 evidence 路径；索引失败时不会留下声称已完整持久化的 evidence。
- 新增只读 `web-runs` 命令，按 project、Workspace、session、状态和 `startedAt` 时间窗筛选，结果倒序并受 `limit` 限制；索引不存在时返回空结果且不创建目录。
- 完整自动验证为 85/85 tests，覆盖参数默认/拒绝、持久写入、项目内 artifact root fail-closed、全维度索引查询、索引发布失败清理和只读空查询。

### M8 兼容探测

- `web-run` 在任何 Workspace/session mutation 和 prompt 前运行只读 compatibility probe；`web-probe` 可独立执行同一探测。
- package version 来自凭据清洗环境中的 `dsh --version`；Host protocol marker 来自 `host.describe.version`，两者不混用。现有 Host API 不能证明 CLI 与 Host 为同一进程版本，evidence 明确记录 `sameProcessAsHost: unverified`。
- 必需 capability 为 `host.describe`、`workspace.list`、`session.list`、`events.mux` 与 `events.host`；RPC schema、Host marker或任一下行连接不兼容都会 fail closed。
- 未知 DSH version 仍允许只读能力采样，但绝不进入 session 创建与 prompt；支持集合当前为 rc.8、0.1.1-rc.1 与 0.1.1-rc.2。
- rc.2 本机 live probe 六项检查全部通过；Host 进程启动时间晚于 rc.2 安装时间，排除了沿用升级前进程。探测未创建 Workspace/session、未发送 prompt；机器 evidence 见 `docs/validation-evidence-summary.md`。
- 完整自动验证为 92/92 tests，覆盖已验证版本、未知版本只读采样、未知 Host marker、WebSocket 缺失/超时、不可覆盖 probe evidence 和参数边界。

### M8 安装与包边界

- beta 保持单一 npm package `codex-dsh-bridge@0.1.0-beta.1`，不提前迁移 monorepo；只有独立公共 API、Cordis host 权限边界或独立发布需求形成后再拆分 core/CLI/adapter。
- 主要 binary 为 `codex-dsh`，`deepseek-loop` 作为兼容 alias；两者均指向真实构建入口 `dist/src/cli.js`。CLI 新增 `--help` 与 `--version`，version 可同时从源码和已安装 package layout 读取。
- DSH 保持外部前置条件，不进入 dependency/peer dependency，Bridge 不自动安装 DSH，也不接管 credentials。发布后安装、更新和卸载流程已写入 `README.md` 与 `docs/package-installation.md`。
- `package.json#files` 使用 allowlist，tarball 只包含运行时 JavaScript/type declarations、五个 schema、两个 prompt、README、MIT LICENSE 与 manifest；测试、真实 evidence、本地 Contract 和源码不会进入发布包。`prepack` 固定执行完整检查。
- 当前 release-candidate `npm pack --dry-run --json` 通过：48,197 bytes tarball、198,449 bytes unpacked、62 个文件。真实 tarball 已安装到全新隔离目录，两个 binary 的 version、help、空索引查询、review schema 与 executor prompt 的 package 内定位均通过。
- 2026-08-24 查询 npm registry 时 `codex-dsh-bridge` 返回 `E404`；这不是名称预留，正式发布前必须复查。当前未执行 publish、全局安装或 DSH 修改。
- 完整自动验证为 93/93 tests。

### M8 GitHub/npm beta 准备

- 新增 `SECURITY.md`，明确私密漏洞报告、credentials/evidence 保护以及 loopback、`web-direct`、Git wrapper 和路径核验的真实安全边界。
- 新增 `CONTRIBUTING.md`，规定开发环境、最小权限协议修改、fake Host 测试、真实 smoke 脱敏和禁止贡献者自行发布。
- 新增 `docs/release-checklist.md` 与 `docs/release-notes-0.1.0-beta.1.md`，覆盖 GitHub repository、npm `beta` dist-tag、release gates、验证与发布后检查。
- 新增 `docs/codex-companion-installation.md`，在 plugin 尚未生成时提供标准 CLI 调用与 Codex review 流程；未来 companion 继续保持薄层。
- 许可证采用 MIT，copyright holder 为 `jony5933`；public repository 已创建于 `https://github.com/jony5933/codex-dsh-bridge`，package metadata 与公开 URL 一致。
- 原始 `docs/evidence` 与本机运行 Contract 已完整移动到 ignored `.private-release-archive/2026-08-24/`，公开仓库只保留 `docs/validation-evidence-summary.md`；原始 evidence 没有被改写。
- `pnpm run release:audit` 扫描 195 个公开候选路径并以 0 findings 通过；`release:snapshot` 已在仓库外生成 96 个实际文件的无历史快照，不包含私有归档。
- release candidate 的 DSH rc.2 live compatibility probe 六项只读检查全部通过，未创建 Workspace/session、未发送 prompt。
- M8 达到 6/6；干净 root commit `8d56ba6921188426bb679d9684a57a6deacaae51` 已推送 `main`，远端文件树为 96 个文件且不含私有目录。仓库 topics 已设置，Private Vulnerability Reporting 已启用。下一步只剩维护者单独授权的 npm `beta`、tag 与 GitHub Release。

## 项目价值与停止门槛

三轮 A3 数据没有显示 Runner 的速度或 Token 优势：direct 与 Runner 都是 3/3 通过且获 `approved`；DSH duration 中位数分别为 20.244 秒与 23.090 秒，包含 review 的总模型流程中位数分别为 54.770 秒与 66.824 秒。Runner 不应定位为 DSH 加速器。

项目的首要价值已经调整为 Web Host Bridge：

- 标准化 Codex → DSH 的调用参数、session 生命周期、终止状态与 evidence；
- 通过同一个 Web Host 事件源让已打开的 DSH Web UI 实时显示进度，无需重新载入；
- 根据项目 canonical path 创建或解析 `Workspace`，避免新任务统一落入 `Ungrouped`；
- 完成后把结构化证据交回 Codex review，不重复建设 Git Review UI。

Runner 的价值收口为可选的确定性控制：

- 高风险任务需要隔离 worktree、禁止 commit/push、路径 allowlist/denylist；
- 关键行为需要目标仓库外部的 acceptance checks，防止 Agent 同时改实现和测试；
- 批量或重复任务需要统一 Contract、失败状态和可追溯 artifacts；
- 团队、合规或无人值守流程需要 Codex review 与执行 Agent 职责分离。

低风险、一次性、人工可立即检查的小修改，目标默认是 `web-direct`；高风险、重复、无人值守或需审计任务显式选择 `web-guarded`。

继续投资采用以下门槛：

1. 先完成 M7 最小闭环，不改造 DSH UI，也不建设通用远程平台。
2. 若真实 smoke 不能同时证明“无需刷新实时可见”和“正确 Workspace 分组”，暂停 M8，不用产品包装掩盖协议缺口。
3. `web-direct` 不强制继承 Runner 成本；只有用户选择 `web-guarded` 时才启用隔离、Git policy、checks、边界和完整 artifacts。
4. Cordis Git Review 继续暂停；Codex 内 review 已满足需求时不开发重复 UI。
5. 历史 `Ungrouped` session 不自动迁移或删除；只有 DSH 提供并验证安全 attach 语义后再单独规划。

## 决策门槛

M7 进入推荐使用前必须满足：

- 既有 M0–M6 证据继续证明 `web-guarded` 的检查、边界和 review 能力，不要求 `web-direct` 为每个任务承担同样成本；
- 已打开的 Web UI 无需刷新即可看到 session 创建、running、增量输出和完成状态；
- session 归入 canonical project path 对应的 Workspace，不进入 `Ungrouped`；
- prompt exactly-once、断线恢复、取消与终止证据通过自动测试和真实 smoke；
- Bridge 的额外时延可接受，但不要求快于直接 headless。

### 通道效率基准指标

“直接调用”与“Runner 通道”必须从相同 `baseCommit` 开始，使用相同目标、模型、验收条件和最大返修轮数；不得把更完整的任务说明只提供给其中一组。每组至少记录：

- Codex 与 DSH 的 input、cached input、output 和 reasoning tokens（CLI 能提供时）；
- 从计划开始到最终审阅结束的 wall-clock duration；
- DSH/Codex 模型调用次数、返修轮数和失败重试次数；
- 人工介入次数及原因；
- checks、路径违规、review findings、最终状态和跨重复运行的结果方差；
- 固定协议文本、任务特定文本和 artifacts 摘要各自占用的上下文规模。

该基准用于回答 Runner 是否减少重复协议理解成本并提高稳定性，不能只比较单次模型 Token；worktree 隔离、fail-closed 和审计证据带来的确定性收益必须单独记录。

## Web Host / ACP 后续设计

Web Host 现在是项目主线，而不是 Runner 之后的第 3 种附属集成。设计仍采用渐进式 transport，不直接改造 DSH Web UI：

1. 抽象 `HarnessTransport`，让 `headless` 与 `web-host` 共用任务指令、超时、日志和规范化终止状态；process exit code 与 Web session metadata 保持为各 transport 专属证据，不互相伪造。
2. `WorkspaceResolver` 使用 `workspace.list/create` 把 canonical project path 解析为 `workspaceId`；`session.create` 使用 `workspaceId + sessionId`，创建后必须核验归属。
3. `WebHostTransport` 使用 HTTP `session.create/prompt/history/cancel`，并订阅 `/api/events.mux` 与 `/api/events.host` 两条 WebSocket；Web UI 因接入同一 Host 而实时显示任务，不依赖页面重新载入。
4. `web-direct` 在用户指定项目执行；`web-guarded` 先创建隔离 worktree，并在完成后运行路径验证、required/acceptance checks、patch 和 artifacts。两者共用协议实现。
5. 只有 Web Host 尚未接受 prompt 时才允许按显式配置回退到 `headless`；接受后发生断线、gap、timeout 或 Host error 必须 fail closed，防止重复修改。
6. rc.8 `since` 尚未实现；重连必须重新读取 history 并按 event `seq` 对账。approval/question 不自动批准，MVP 应阻断并交给人工。
7. `reportDelivery` 和进程内 `dsh-jobs` 都不作为 Bridge completion dependency。ACP 仅保留为后续候选，先完成现有 Web Host API 验证。

该方案解决当前“终端启动的 headless 任务不会自动出现在已打开 Web UI”以及“需要重新载入才能看到外部状态”的可见性问题，但不作为 M3–M6 的前置条件。

## 已知风险与待处理项

- 活跃 Contract 通过 PATH 使用全局 `dsh`；历史 artifacts 保留当时的绝对命令作为审计证据，不做改写。
- Node 24.19 已安装在 `~/.nvm`，并已通过 `~/.zprofile` 同步到登录 shell；`zsh -lc` 已验证使用 `v24.19.0`。
- DSH headless 通常只在结束时输出最终总结；Runner 已支持逐 chunk 转发，但更细粒度事件需要 DSH/ACP 提供事件流。
- 默认 Web evidence 与运行索引已持久保存到 `~/.dsh-bridge/runs`；历史 `/private/tmp` artifacts 仍可能被系统清理，不应作为长期唯一证据。
- 编排仓库已有用户授权的初始基线 commit `6132189`；其后的工作保持未提交，等待维护者逐阶段 review。
- DSH Web UI 与外部 headless 进程没有实时事件桥；共享 session root 使刷新后的 `session.list` 能看到任务，但不会收到跨进程 `host/session-added`。WebHostTransport 可通过同一 Host 事件源解决。
- Web Host API 没有独立 `protocolVersion`，client 与 Host 预期同步发布；每次 DSH 升级都必须重跑 adapter contract tests 和只读 live compatibility probe。当前已验证到 DSH `0.1.1-rc.2`。
- rc.8 Web Host API 没有 per-session environment 或 Skill patch 参数；因此 `web-guarded` 当前只能执行事后 Git ref audit，不能继承 headless 的预防式 Git `PATH` wrapper 或隔离 Skill catalog。需要这些控制的任务继续使用 `headless`。
- 本地真实模型调用使用 DSH 管理的 `~/.dsh/.credentials.yaml`，Web 与 `headless` 共用且文件权限为 `0600`；同一系统用户的进程仍可能读取该文件，未来产品化应评估 Keychain/KMS 类凭据提供方。
- checks 已不继承环境变量凭据，但这不能阻止同一系统用户按已知绝对路径读取凭据文件；完整隔离仍需容器或 OS sandbox。
- Codex CLI 当前来自 Codex App 内部 bundled 路径和 alpha 版本，不应硬编码为稳定产品接口；自动 review 接入前需做版本与输出协议探测。

## 进度维护规则

- 只有存在可复现证据（测试、report、patch 或 review 结果）时才标记“已完成”。
- 每次真实运行追加 Run ID、基线 commit、检查结果和 artifacts 位置。
- 改变实验变量时必须从同一 base commit 开始，并在本文件注明唯一变化。
- 路线变化应记录原因，不直接删除失败或被放弃的里程碑。
