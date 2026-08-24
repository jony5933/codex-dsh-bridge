# 验证证据公开摘要

更新日期：2026-08-24

## 公开策略

公开仓库只保留脱敏摘要、Run ID、固定 commit、检查结果和已知边界。原始 prompt、JSONL、patch、model output、绝对路径与本机运行 Contract 不进入公开 release snapshot。

原始 evidence 已完整移动到本地 ignored 私有归档：

```text
.private-release-archive/2026-08-24/
  docs-evidence/
  contracts-runs/
```

该目录不会进入 GitHub 或 npm package。当前开发仓库的旧 Git history 曾包含部分原始 evidence，因此公开仓库必须从脱敏后的 release snapshot 建立新历史，不能直接推送旧历史。

## Runner 基线与 review

| 验证 | Run ID / 标识 | 公开结果 |
| --- | --- | --- |
| 基础执行闭环 | `daily-window-midnight-20260817033729874` | DSH 退出 0；5/5 tests；无路径越界 |
| 实时输出复验 | `daily-window-midnight-20260817055850462` | 生命周期实时显示；5/5 tests |
| A2 跨文件任务 | `access-request-layers-v2-20260820072713067` | Runner passed；外部 acceptance passed；Codex `approved` |
| A3 行为保持重构 | `daily-window-validation-refactor-20260820073423927` | Runner passed；外部 acceptance passed；Codex `approved` |
| Codex CLI adapter | `codex-review-adapter-smoke` | read-only、structured output、usage 审计与 fail-closed 矩阵通过 |

Runner 真实验证目标固定在同一测试仓库 commit `9b63808f6e5c3dfc53cee01c20898bd73d78d163`。公开摘要不包含目标仓库绝对路径。

## DSH Skill 对照

| 验证 | 公开结果 |
| --- | --- |
| 外部 Skill 注入 smoke | Harness-only environment、bundle hash、投影完整性和隔离 checks 通过 |
| rc.7 B1/B2 | 同一任务无 Skill/有 Skill 配对完成；结果记录在公开 scorecard |
| rc.8 remediation | 12/12 tests、TypeScript、build 与独立 Codex `approved` |

失败的首次 rc.8 validation infrastructure 结果也保留在私有归档，没有覆盖或改写。

## Web Host Bridge

| 验证 | 标识 | 公开结果 |
| --- | --- | --- |
| rc.8 read-only probe | `rc8-readonly-probe` | `host.describe`、`session.list` 与双 WebSocket 行为确认；无 session mutation |
| rc.8 client smoke | `rc8-client-smoke` | HTTP envelope/correlation 与 mux/host downlink 通过 |
| M7 真实 Web Host | session `53ee4719-cc6b-43e8-8319-1e8cf80c5395` | session 正确归入 Workspace；prompt 只接受一次；terminal `completed`；UI 无需刷新可见 |
| DSH rc.2 compatibility | probe `82190bd4-c77e-47dd-b37b-b4fdfa9e87fd` | 六项只读检查通过；未创建 Workspace/session、未发送 prompt |
| release candidate rc.2 compatibility | probe `e847c678-7a35-42bb-89fc-d8beeaf8cdf8` | 六项只读检查通过；未创建 Workspace/session、未发送 prompt |

M7 smoke 前后目标 HEAD 与 tracked Git status 不变。Bridge 的完成判定同时核对 terminal event、history seq 与最终 running 状态，而不是只信任模型声明。

## 通道效率基准

A3 使用相同 base commit、任务目标、检查与 review，完成三轮 direct/Runner 交替配对：

- direct：3/3 passed，3/3 Codex `approved`；
- Runner：3/3 passed，3/3 Codex `approved`；
- DSH duration 中位数：direct 20.244 秒，Runner 23.090 秒；
- 含 Codex review 的总模型流程中位数：direct 54.770 秒，Runner 66.824 秒。

数据不支持把 Runner 定位为速度或 Token 优化器；它的价值是按需提供 worktree、Git policy、checks、路径边界和可追溯 artifacts。

## 自动验证

- 当前 release candidate：93/93 tests。
- 公开候选审计：195 个候选路径，0 findings。
- 干净 release snapshot：96 个实际文件，不包含旧 Git history、原始 evidence 或私有归档。
- 覆盖 Runner、Codex review adapter、Web Host client/session/Workspace、compatibility probe、持久 evidence、运行索引和 package version。
- npm tarball 与隔离安装结果见 `docs/package-installation.md`。

## 原始证据访问

原始证据仅用于维护者本地复核，不构成公开 API，也不随 npm package 分发。需要对公开结论进行第三方复现时，应使用公开 Contract example、测试和固定验证步骤重新生成新的脱敏 evidence，而不是公开历史原始 session。
