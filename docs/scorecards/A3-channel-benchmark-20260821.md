# A3 通道效率配对基准

更新日期：2026-08-21

## 结论

三轮配对中，直接调用与 Runner 通道均 3/3 通过全部检查并获得 Codex `approved`。direct 的 DSH duration 中位数为 20.244 秒，Runner 为 23.090 秒；加入 review 后分别为 54.770 秒和 66.824 秒。这个小样本显示 direct 在当前单文件小任务上更快，但 Runner 极差较大、样本只有三轮，不能据此推断到大型或高风险任务。

Runner 的确定性收益已经可观察：一条命令自动创建隔离 worktree、安装 Git policy、执行 required/acceptance checks、检查路径边界，并生成受 schema 约束的完整报告。直接组需要 Codex 分步创建 worktree、保存日志、执行检查、生成 diff 和拼装独立的 direct evidence，而且没有 Git wrapper。

## 控制变量

| 项目 | 两组共同值 |
| --- | --- |
| 目标仓库 | `<validation-repository>` |
| base commit | `9b63808f6e5c3dfc53cee01c20898bd73d78d163` |
| 任务 | `daily-window-validation-refactor` |
| DSH | `0.1.0-rc.8`，`headless` profile |
| 模型 | `deepseek-v4-flash` |
| DSH prompt | 2,583 bytes；SHA-256 `59c9ae0c43314b6fd7f20451fe96aea89756374e11b1750a6a9cff3286cbceed` |
| 固定执行协议 | 792 bytes；其余 1,791 bytes 为分隔结构与任务 Contract |
| 验收 | `npm test` + 外部 `a3-daily-window-behavior` |
| Codex review | 同一 bundled CLI、review schema、read-only sandbox、never approval |

唯一计划变量为执行通道。Runner 组使用任务分支和 Git policy wrapper；直接组使用 detached worktree 且无 wrapper，这些是通道本身提供的能力差异，不是额外任务信息。

## 结果

| 指标 | 直接调用 DSH | Runner 通道 |
| --- | ---: | ---: |
| Run ID | `a3-direct-202608210537` | `daily-window-validation-refactor-20260821053555247` |
| DSH 状态 | exit 0 | exit 0，Runner `passed` |
| DSH duration | 22.933 秒 | 39.271 秒 |
| DSH 模型调用 | 6 | 7 |
| DSH input tokens | 9,914 | 10,250 |
| DSH cached read tokens | 49,536 | 68,992 |
| DSH output tokens | 2,268 | 4,701 |
| DSH reasoning tokens | 978 | 2,624 |
| 修改规模 | `+9/-3`，1 个文件 | `+14/-3`，1 个文件 |
| required check | 4/4 通过 | 4/4 通过 |
| 外部 acceptance | 通过 | 通过 |
| 路径违规 | 0（Codex 手动核对） | 0（Runner 自动核对） |
| Git policy | 无 | verified，无违规 |
| Codex review | `approved`，0 findings | `approved`，0 findings |
| Codex review duration | 29.050 秒 | 54.727 秒 |
| Codex input / cached | 33,651 / 15,104 | 32,930 / 14,080 |
| Codex output / reasoning | 488 / 48 | 864 / 459 |
| DSH + review duration | 51.983 秒 | 93.998 秒 |
| 人工介入 | 0 | 0 |

`DSH + review duration` 只相加两个模型进程的实测 duration；直接组的 worktree/检查/证据拼装和 Runner 组的准备/验证开销另行保留在 artifacts 中，不能解释为完整端到端 wall clock。

## 实现方差

- 直接组在函数内创建 `[name, value]` tuple 集合并迭代，改动较小。
- Runner 组创建模块级 descriptor 常量和私有验证 helper，可读性仍可接受，但结构更重。
- 两种实现均保持验证顺序、精确错误消息、public API 和窗口语义，外部 acceptance 与独立 Codex review 均确认通过。
- 三轮共得到 5 个不同 patch：direct 第 1、3 轮完全相同，第 2 轮使用 object 集合；Runner 三轮分别为模块级 helper、精简 tuple 和局部 tuple。所有实现均通过同一外部行为检查，说明模型采样带来的结构方差没有转化为行为方差。

## 第 2 轮：反转顺序

第 2 轮先运行 direct、后运行 Runner。其余控制变量与 prompt hash 完全不变。

| 指标 | direct 第 2 轮 | Runner 第 2 轮 |
| --- | ---: | ---: |
| Run ID | `a3-direct-r2-20260821055845` | `daily-window-validation-refactor-20260821055955773` |
| DSH duration | 18.468 秒 | 19.311 秒 |
| DSH 模型调用 | 5 | 6 |
| DSH input / cached | 9,492 / 38,272 | 10,020 / 48,896 |
| DSH output / reasoning | 2,030 / 818 | 1,989 / 627 |
| 修改规模 | `+9/-3` | `+8/-3` |
| required / acceptance | 全部通过 | 全部通过 |
| Codex review | `approved`，0 findings | `approved`，0 findings |
| Codex review duration | 36.302 秒 | 35.962 秒 |
| Codex input / cached | 50,156 / 31,232 | 34,913 / 15,104 |
| Codex output / reasoning | 587 / 96 | 547 / 182 |
| DSH + review duration | 54.770 秒 | 55.273 秒 |

第 2 轮 direct 使用 `{ value, name }` object 集合，Runner 使用 `[value, name]` tuple；两者均比首轮 Runner 的模块级 helper 更小。中性 reviewer prompt 正确识别了 direct 的 manual controls，最终 summary 没有再声称执行了 Runner Git policy。

## 第 3 轮：恢复 Runner → direct

第 3 轮恢复 Runner → direct 顺序。其余控制变量与前两轮完全一致。

| 指标 | direct 第 3 轮 | Runner 第 3 轮 |
| --- | ---: | ---: |
| Run ID | `a3-direct-r3-20260821060627` | `daily-window-validation-refactor-20260821060559008` |
| DSH duration | 20.244 秒 | 23.090 秒 |
| DSH 模型调用 | 6 | 7 |
| DSH input / cached | 10,072 / 49,920 | 10,207 / 60,544 |
| DSH output / reasoning | 2,433 / 1,125 | 2,371 / 942 |
| 修改规模 | `+9/-3` | `+9/-3` |
| required / acceptance | 全部通过 | 全部通过 |
| Codex review | `approved`，0 findings | `approved`，0 findings |
| Codex review duration | 43.602 秒 | 43.734 秒 |
| Codex input / cached | 32,833 / 0 | 35,112 / 0 |
| Codex output / reasoning | 501 / 54 | 762 / 296 |
| DSH + review duration | 63.846 秒 | 66.824 秒 |

direct 第 3 轮与第 1 轮产生完全相同的 `[name, value]` tuple patch；Runner 使用 `[value, name]` tuple。两个 patch 都只修改目标文件，并由外部 acceptance 和 Codex review 确认行为保持。

## 三轮最终汇总

| 指标 | direct | Runner |
| --- | ---: | ---: |
| 通过并 approved | 3/3（100%） | 3/3（100%） |
| DSH duration 中位数 | 20.244 秒 | 23.090 秒 |
| DSH duration 极差 | 4.465 秒 | 19.960 秒 |
| DSH 模型调用中位数 | 6 | 7 |
| DSH input tokens 中位数 | 9,914 | 10,207 |
| DSH input tokens 极差 | 580 | 230 |
| DSH output tokens 中位数 | 2,268 | 2,371 |
| Codex review duration 中位数 | 36.302 秒 | 43.734 秒 |
| DSH + review duration 中位数 | 54.770 秒 | 66.824 秒 |
| DSH + review duration 极差 | 11.863 秒 | 38.725 秒 |
| 不同 patch 数 | 2/3 | 3/3 |

在这个小型、边界清晰的任务上，Runner 没有减少 DSH Token：其中位 input 比 direct 高 293 tokens，模型调用中位数多 1 次；总模型进程中位耗时高 12.054 秒。特别是 Codex review 的 input/cached usage 会受其自主读取文件次数影响，不能把 reviewer Token 简单归因于 evidence 长度。

Runner 的收益因此不应表述为“小任务更省 Token”或“天然更快”，而是把每次都要由外层 Codex 重复完成的隔离、Git 禁令、独立检查、边界核验和 evidence 拼装固化为 fail-closed 通道。本基准没有计量主 Codex 手工编排 direct 通道所消耗的 Token 和 wall clock，所以也不能计算 Runner 的完整端到端节省。当前决策是保留 Runner 作为高约束与可审计执行通道；对低风险、一次性小任务，可继续允许直接调用。

## 证据与限制

- 公开结论见 `docs/validation-evidence-summary.md`；六次运行的原始 prompt、patch、日志、usage、review candidate、execution 和最终 review 仅保存在维护者私有归档。
- rc.8 session 使用 concatenated Zstandard frames；项目新增 `dsh-session-metrics` 只读命令，从 `assistant/message.data.usage` 汇总 Token，避免把 chunk 与最终 message 重复计数。
- 直接组使用独立 `contracts/direct-evidence.schema.json`，明确声明 `gitPolicy: false`、`automatedChecks: false` 和 `automatedBoundaryCheck: false`，不再借用或伪装 Runner `RunReport`。
- 首轮 direct review 发生在该 schema 落地之前；归档的 review prompt 保留当时的旧 evidence，随后 canonical `direct-evidence.json` 已迁移并通过 validator。为保留 canonical `review.json` 不覆盖，未重复消耗模型重跑审阅。
- 首轮直接组 review summary 使用了“Runner checks”措辞；实际检查由 Codex 在直接 worktree 上独立执行。协议现已改为中性的 `Execution evidence`，并明确 channel 与 controls；历史 candidate 保留原貌作为审计证据。
- 当前没有统计本次交互中主 Codex 的 planning Token；DSH 与独立 Codex CLI usage 均有机器证据。后续若比较“协议理解成本”，需让两组都由可计量的外层 Codex CLI 驱动。

## 后续使用原则

1. 需要可重复执行、路径保护、Git policy、自动检查或审计证据时，默认使用 Runner。
2. 低风险的一次性小改动可直接调用 DSH，但必须由 Codex 显式创建隔离 worktree、补跑检查并生成 direct evidence；不能把模型自述当成完成凭据。
3. 下一阶段转向 rc.8 session/Web Host transport 验证；若未来要证明“节省外层 Codex Token”，应把 planning 和编排也放入可计量的 Codex CLI 驱动实验。
