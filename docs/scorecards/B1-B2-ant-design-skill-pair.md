# B1/B2 Ant Design Skill 配对评分

评估日期：2026-08-21

## 结论

专用 Skill 在这一次受控配对中改善了核心实现正确性，但没有让任务一次通过，也没有证明节省时间或 Token。rc.8 remediation 最终完成 `passed + approved` 闭环，证明通道可行；由于版本、prompt 与运行阶段不同，它只作为闭环验证，不纳入 B1/B2 因果比较。

## 受控样本

| 指标 | B1：空 Skill catalog | B2：显式专用 Skill |
| --- | --- | --- |
| DSH 版本 | rc.7 | rc.7 |
| baseCommit / objective / paths / acceptance | 相同 | 相同 |
| DSH duration | 622.195 秒 | 775.234 秒 |
| 隐藏行为验收 | 未通过错误语义 | 2/2 通过 |
| 目标测试 | 8/10 | 9/11 |
| Codex review | `changes-requested` | `changes-requested` |
| 关键 findings | P1 错误语义；P2 歧义 Empty query | P1 歧义 Empty query |

## 评分

| 维度 | B1 | B2 | 依据 |
| --- | ---: | ---: | --- |
| 核心实现正确性（5） | 2 | 5 | B2 正确保留 pending、失败 `success: false`、retry/recovery；B1 混淆 error 与 empty |
| 测试质量（5） | 2 | 3 | 两组都使用过歧义 `getByText('No data')`；B2 覆盖行为更多但仍未通过 |
| 路径与协议遵守（5） | 5 | 5 | 两组均只修改两个 allowed files，Skill/边界审计无违规 |
| 一次通过能力（5） | 1 | 1 | 两组 Runner 与 Codex review 最终均未通过 |
| 执行效率（5） | 3 | 2 | B2 比 B1 多 153.039 秒；无 DSH usage 证据，不能评分 Token |
| 合计（25） | 13 | 16 | 本次结果偏向 B2，但样本量只有 1 对 |

## rc.8 remediation（非受控样本）

- Run ID：`ant-design-table-states-b2-rc8-20260821044006042`。
- DSH duration：723.762 秒；只修改两个 allowed files，Skill verified，无边界违规。
- 独立验收：12/12 tests、TypeScript、production build、`git diff --check` 全部通过。
- Codex review：`approved`，无 findings 或 blockers；96.714 秒。
- 持久证据：`docs/validation-evidence-summary.md`。

## 限制与下一步

- 单个任务不能证明普遍收益；目标仓库还自带两组共有的 `.claude/skills/antd/SKILL.md`，因此这里只能证明 DSH native catalog 的差异。
- DSH 当前报告不提供可靠 usage，不能声称 Skill 节省 Token。
- rc.8 remediation 使用了明确指出昨日 finding 的 prompt，且 DSH 版本不同，不能回填为 B2 的 iteration 1 对照数据。
- 下一阶段先做 M6 fail-closed 对抗验证；M9 再用相同模型、任务、baseCommit 与验收条件比较“直接调用”与“Runner 通道”的成本和稳定性。
