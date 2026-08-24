# Runner 外部 DSH Skill 注入 smoke

- 验证日期：2026-08-20
- Runner Contract：`private archived Contract`
- DSH：`@deepseek-ai/dsh@0.1.0-rc.7`，`headless`
- 目标仓库：`<validation-repository>`
- Base commit：`9b63808f6e5c3dfc53cee01c20898bd73d78d163`
- 权威 Run ID：`runner-external-skill-smoke-20260820082342502`

## 实现范围

- `contracts/task.schema.json` 新增 `skills.root`、`skills.names` 和 `skills.invocation`。
- `src/skills.ts` 负责 canonical path、外部位置、YAML frontmatter、symlink、常规文件、确定性 SHA-256、artifact 投影和 Harness 后完整性复核。
- Runner 生成 `skills.patch.yml`，设置 `skill-filesystem.includeDefaultRoots: false`，只把 artifact 投影目录注册为 `customSkillDirs`。
- 配置 `skills` 时，`harness.args` 必须包含 `{skillPatch}`；`explicit` invocation 会把 `/name` 作为用户手势加入 DSH prompt。
- `DSH_BUNDLED_SKILL_DIR` 只提供给 Harness；required checks、acceptance checks 和 Codex reviewer 不继承。
- `result.json.skills` 记录隔离/启用状态、source/staged root、patch 路径及 hash、bundle hash/文件数和后置 verification。
- Harness 后若 patch、投影成员或 bundle hash 变化，Runner fail closed。

## 自动测试

`pnpm run check` 通过，31/31 tests 通过。新增覆盖：

- 只投影 Contract 声明的 Skill，不混入同一 source root 的其他 bundle；
- explicit prompt 包含 `/name`；
- checks 看不到 `DSH_BUNDLED_SKILL_DIR`；
- `skills.names: []` 会生成关闭默认 roots 的隔离空 catalog；
- 仓库内 Skill root 和 bundle symlink 在 Harness 启动前被拒绝；
- fake Harness 篡改投影后，即使项目 required check 通过，run 仍因完整性违规失败。

## 真实 smoke

外部 Skill：`contracts/skills/runner-channel-proof/SKILL.md`。Skill 正文要求创建一个 Contract 未包含精确内容的证明文件；外部 acceptance check 持有精确预期。

- DSH exit 0，14.921 秒，未超时，stderr 为空。
- required check `test -f src/skill-smoke-proof.txt` exit 0。
- 外部 `runner-skill-proof` exit 0，并确认 checks 环境中不存在 `DSH_BUNDLED_SKILL_DIR`。
- 只新增允许的 `src/skill-smoke-proof.txt`，内容为 `DSH_RUNNER_SKILL_PROOF_V1\n`；无路径违规。
- 目标仓库主工作目录未变化，仍只有用户原有 `.DS_Store` 未跟踪项。
- Skill isolation patch hash：`c48cc8c6deec7e7eb5d392da654e6f1aef850c1efad1ae3c55676dc052668402`。
- Skill bundle hash：`c9cc4f3d3e6d4110638616656e35ca71b2c7aef6d6cec279cb7f0bd3d61f8f85`，1 个文件。
- Harness 后 `skills.verified: true`，`skills.violations: []`。

Artifacts：`<private-artifact-root>/.artifacts/runner-external-skill-smoke-20260820082342502`

## 配对实验用法

B1 和 B2 都必须配置 `skills` 并在同一位置提供 `{skillPatch}`，以关闭本机项目级和用户级默认 Skill：

- B1：`"skills": { "names": [] }`。
- B2：同一任务字段不变，仅设置外部 `root`、目标 `names` 和 invocation。

完全省略 `skills` 只保持普通 Runner 的向后兼容行为，不能当作严格隔离的无 Skill 实验。

## 结论

Runner 外部 Skill 注入与审计通道已经通过 fake Harness 对抗测试和真实 DSH smoke。M5 下一步可以直接准备固定版本 Ant Design 目标仓库、外部验收和 B1/B2 配对 Contract，不再需要修改目标 base commit 来携带 Skill。
