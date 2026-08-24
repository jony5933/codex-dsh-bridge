# A2 v2 跨文件校验任务评分记录

## 实验信息

| 字段 | 结果 |
| --- | --- |
| 案例 | A2 v2 |
| Run ID | `access-request-layers-v2-20260820072713067` |
| Base commit | `9b63808f6e5c3dfc53cee01c20898bd73d78d163` |
| 目标仓库 | `<validation-repository>` |
| 实验变量 | 无 Skill；从与旧 A2 相同的 base commit 启动新的根 Contract，加入不可漂移的响应要求、外部 acceptance check 和结构化 Codex review |
| 最终审阅结果 | `approved` |
| 返修轮数 | 0 |
| 人工介入 | Codex 编写 Contract、外部 acceptance check，审计证据并发起只读 review；未人工修改 DSH 生成的目标代码 |

## Runner 与 DSH 结果

- DSH：退出 0，56.461 秒，未超时。
- `requiredChecks`：`npm test` 退出 0，25/25 tests 通过。
- 外部 `acceptanceChecks`：`a2-stable-contract` 退出 0，确认 Policy 错误分类、enabled/disabled 配对、精确 Service/Controller 响应、原生异常透传及 `isWithinDailyWindow` 复用。
- 路径边界：只新增 `src/access-policy.js`、`src/access-service.js`、`src/access-controller.js`、`test/access-request.test.js`，违规项为 0。
- 受保护的 `src/daily-window.js`、`test/daily-window.test.js`、`package.json` 和 `README.md` 相对 base commit 无变化。
- 目标仓库主工作目录未被 DSH 修改；用户已有 `.DS_Store` 仍保持未跟踪状态。

## Codex review

- Adapter execution：`passed`，退出 0，62.319 秒，未超时。
- 审阅结果：`approved`；`findings` 和 `blockers` 均为空。
- 审阅确认四个改动文件符合 Contract，Runner checks 和外部 acceptance 均可作为支持证据。
- Usage：40,199 input、14,080 cached input、667 output、221 reasoning output tokens。
- 首次 WebSocket 连接出现一次 TLS handshake EOF，CLI 随后正常完成；JSONL 包含 `turn.completed`，candidate 与 canonical `review.json` 一致，failure reasons 为空。
- Review 前后 worktree 仍只有相同四个新增文件，目标仓库状态保持不变。

## Artifacts

- Runner：`<private-artifact-root>/.artifacts/access-request-layers-v2-20260820072713067/result.json`
- Patch：`<private-artifact-root>/.artifacts/access-request-layers-v2-20260820072713067/changes.patch`
- Review：`<private-artifact-root>/.artifacts/access-request-layers-v2-20260820072713067/review.json`
- Codex attempt：`<private-artifact-root>/.artifacts/access-request-layers-v2-20260820072713067/codex-review-20260820072952338-69a76acb-3286-48dd-942b-dbe2ba93944f`

## 结论

A2 v2 完成了 Codex 计划 → DSH 修改 → Runner 独立验证 → Codex review 的一次无返修真实闭环。旧 A2 的窗口校验、异常误分类和响应结构漂移均由新的根 Contract 与外部 acceptance check 固定，最终没有开放问题。该 run 可以作为 M3 的第二个无 Skill 基线证据；是否接受或合并目标 patch 仍由用户决定。
