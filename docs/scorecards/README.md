# 实验评分记录

每次真实 DSH 运行使用一份独立记录，文件名为 `<案例>-<runId>.md`。只有可从 Contract、`result.json`、`changes.patch`、测试输出或 Codex review 复核的事实才能写入结果字段。

## 必填字段

| 字段 | 含义 |
| --- | --- |
| 案例 | A1、A2、A3、B1、B2 或 C 系列编号 |
| Run ID | Runner 生成的唯一运行编号 |
| Base commit | 本次运行固定的 Git commit |
| 实验变量 | 相对配对基线唯一发生变化的因素 |
| 首次执行 | Harness 退出状态、耗时和超时状态 |
| 独立检查 | 每条 `requiredChecks` 的退出状态 |
| 路径边界 | 修改文件、允许文件和违规项 |
| 审阅结果 | `approved`、`changes-requested` 或 `blocked` |
| 审阅问题 | 严重度、文件位置、证据和最小修复要求 |
| 返修轮数 | Codex → DSH 的追加修复次数 |
| 人工介入 | 人工操作及其原因 |
| Artifacts | `result.json` 和 `changes.patch` 的位置 |

## 判定规则

- Harness 失败、超时、独立检查失败或路径越界时，运行结果不得记为通过。
- DSH 的文字声明不计为证据。
- `approved` 必须同时满足 Runner 通过和无未解决的 Codex 审阅问题。
- `changes-requested` 必须记录最小返修范围；自动返修最多两轮。
- 配对实验必须使用相同 `baseCommit` 和验收条件，并明确唯一实验变量。
