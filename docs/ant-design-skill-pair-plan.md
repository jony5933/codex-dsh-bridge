# Ant Design Skill 配对实验计划

## 固定目标

- 官方仓库：`ant-design/ant-design-pro`
- 本地目标：`<ant-design-validation-repository>`
- 版本：`6.0.3`
- `baseCommit`：`adfd44085738ca953573a13322c1ba84aca8b9e3`
- Node：`24.19.0`
- 页面范围：`src/pages/table-list/index.tsx` 与对应测试

选择该目标的原因是它同时具备真实的 Ant Design Pro/ProTable 数据流、mock API、Vitest、TypeScript 和 production build，且可将修改限制在一个页面与一个测试文件。它作为真实复杂项目使用；Runner 自身的快速 smoke 仍使用轻量 fixture。

## Untouched baseline

- `npm test -- --run src/pages/table-list/index.test.tsx`：5/5 通过。
- `npm test`：9 个 Test Files、54/54 tests 通过。
- `npm run tsc`：通过。
- `npm run build`：通过，生成 88 个 assets。
- baseline 后目标仓库无 tracked source diff。
- `npm ci` 安装了 2072 个 packages，并报告 51 个上游依赖漏洞；本实验不执行 `npm audit fix`，避免改变固定依赖图。

## 配对变量

| 项目 | B1 | B2 |
| --- | --- | --- |
| Task objective | 相同 | 相同 |
| baseCommit | 相同 | 相同 |
| allowed/forbidden paths | 相同 | 相同 |
| acceptance 与 checks | 相同 | 相同 |
| DSH profile/model | 相同 | 相同 |
| Skill catalog | 隔离空 catalog | 只注入 `ant-design-pro-table-states` |

B2 使用 explicit invocation，确保 Skill availability 与 invocation 同时成立。除 `taskId` 和 `skills` 外，两份根 Contract 的任务字段应保持一致。

## 独立验收

外部 acceptance check 位于 Runner 仓库中，不发送给 DSH。Harness 退出后才执行以下动作：

1. 拒绝 DSH 自行创建 `node_modules` 或隐藏验收文件；
2. 使用 APFS copy-on-write 把固定目标仓库的已安装 `node_modules` 克隆到执行 worktree；
3. 临时复制隐藏 Vitest，验证 pending、empty、error、retry 与 recovery；
4. 运行目标页面原有测试、`tsc` 和 production build；
5. 在路径边界检查前移除临时测试、依赖副本、Umi 生成目录和 build 输出。

该副本只存在于 DSH 完成后的独立检查阶段，不向执行代理暴露主工作目录依赖路径。最初的逐包 symlink 方案会被 Utoopack 拒绝，因为依赖真实路径位于 worktree 外；APFS clone-on-write 同时满足路径隔离与复用固定 lockfile 安装结果，避免每次重复约 6 分钟的 `npm ci`。

## 判定

- Runner `passed` 只是进入 Codex review 的门槛。
- 两组均需检查 `result.json`、`changes.patch`、Skill 投影、changed paths、hidden acceptance、目标仓库主工作目录和 Codex review。
- 最终比较 correctness、patch complexity、测试质量、DSH duration、review findings 与人工返修需求；单次胜负不直接证明 Skill 普遍有效。

## 2026-08-20 配对结果

### B1：隔离空 Skill catalog

- Run ID：`ant-design-table-states-b1-20260820091357846`
- Artifacts：`<private-ant-design-artifact-root>/.artifacts/ant-design-table-states-b1-20260820091357846`
- 持久副本：`docs/validation-evidence-summary.md`
- DSH：exit 0，622.195 秒；只修改两个 allowed files，路径边界通过。
- Skill 审计：`isolated: true`、`enabled: false`、`verified: true`、`violations: []`。
- 独立验收：失败。目标测试与隐藏测试合计 8/10 通过。
- 实现问题：request rejection 被回退为 `success: true`，混淆 error 与 successful empty 语义。
- 测试问题：新增 Empty test 使用 `getByText('No data')`，同时匹配 SVG `<title>` 与可见 description。
- Codex review：`changes-requested`，一个 P1 实现 finding、一个 P2 测试 finding。
- Review usage：79,038 input、45,568 cached input、1,192 output、344 reasoning output tokens；53.630 秒。

### B2：显式注入专用 Skill

- Run ID：`ant-design-table-states-b2-20260820092447283`
- Artifacts：`<private-ant-design-artifact-root>/.artifacts/ant-design-table-states-b2-20260820092447283`
- 持久副本：`docs/validation-evidence-summary.md`
- DSH：exit 0，775.234 秒；只修改两个 allowed files，路径边界通过。
- Skill 审计：`isolated: true`、`enabled: true`、`invocation: explicit`、`verified: true`、`violations: []`；bundle hash 为 `af0f47a593e853abe706cbedb507a9dec8ebdc6125f90e0917788897d90db951`。
- 隐藏行为验收 2/2 通过：B2 正确保留 pending Promise、使用 `success: false` 表达失败，并通过 error/retry/recovery 验证。
- 整体独立验收仍失败：DSH 自己新增的两个 Empty tests 使用同样的歧义 `getByText('No data')`，目标测试为 9/11 通过；另有既有测试触发的 React `act(...)` warning。
- Codex review：`changes-requested`，一个 P1 测试 finding；未发现 B1 的错误响应语义问题。
- Review usage：81,614 input、29,440 cached input、975 output、324 reasoning output tokens；66.206 秒。

### 暂时结论

- 专用 Skill 改善了核心 implementation correctness：B2 通过全部隐藏行为验收，而 B1 未通过。
- Skill 没有保证测试代码正确；两组都犯了相同的 Ant Empty 文本定位器错误。
- B2 的 DSH 时间比 B1 多 153.039 秒，patch 也更大；单次结果不能证明 Skill 节省时间或 Token。
- 官方目标仓库自身包含 `.claude/skills/antd/SKILL.md`。它在两组目标树中都相同，因此不破坏 B1/B2 的相对唯一变量，但这次 B1 不能描述为“目标环境完全不存在任何 Skill 文件”；Runner 只能保证 DSH native catalog 为空。

## 2026-08-21 rc.8 remediation 结果

- DSH 升级后旧 rc.7 npx 可执行路径失效，因此没有改写昨日 B2 的原始 lineage；另建 `ant-design-table-states-b2-rc8` 根 Contract，明确作为 remediation run，而不是配对样本。
- 首次 rc.8 run 的代码与 12/12 tests 均通过，但独立验收暴露 fresh worktree 缺少 Umi 生成类型、依赖 symlink 被 Utoopack 拒绝等验证基础设施问题；原失败报告保留在 `docs/validation-evidence-summary.md`，不覆写。
- 修正 acceptance 后 canonical Run ID 为 `ant-design-table-states-b2-rc8-20260821044006042`：DSH exit 0，723.762 秒；只修改两个 allowed files，无路径或 Skill 投影违规。
- 独立验收通过：目标测试与隐藏测试合计 12/12、TypeScript、production build、`git diff --check` 全部通过。测试 stderr 仍记录三个既有测试的 React `act(...)` warning，但不影响断言结果。
- Codex review 为 `approved`，无 findings 或 blockers；审阅耗时 96.714 秒，usage 为 116,275 input、77,824 cached input、1,646 output、692 reasoning output tokens。
- 完整持久证据：`docs/validation-evidence-summary.md`。

## 实验结论

- rc.7 的原始 B1/B2 仍是唯一受控配对：B2 的专用 Skill 改善了核心错误语义与隐藏行为验收，但两组都没有一次通过，且 B2 更慢。
- rc.8 remediation 证明 `Codex 计划 → DSH + Skill 修改 → Runner 独立验收 → Codex review` 可以形成 `passed + approved` 的完整闭环；它不能用于计算 rc.7 B1/B2 的纯 Skill 因果收益。
- 现有证据支持保留“可约束通道 + 按任务注入 Skill”，但尚不支持“Skill 必然节省 Token 或时间”。后者进入 M9 通道效率基准。
- 首轮评分记录：`docs/scorecards/B1-B2-ant-design-skill-pair.md`。
