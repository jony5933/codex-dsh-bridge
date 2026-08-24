# Codex review adapter 真实 smoke

- 日期：2026-08-20
- Fixture：`<temporary-review-smoke>/`
- CLI：Codex App bundled `codex-cli 0.148.0-alpha.15`
- 目标：证明显式 adapter 能在只读小型 Git fixture 上发现 Runner 项目内 checks 未覆盖的 Contract 漂移

## 场景

`normalizeWindow` 的 Contract 要求无论 `disabled` 为 true 或 false，都必须先验证整数边界与 `start < end`。Fixture 实现在 `disabled: true` 时提前返回，项目内 3 项测试仍全部通过，因为测试只覆盖有效 disabled 输入。

Fixture 是无 commit 的专用临时 Git 仓库；没有修改真实目标 `<validation-repository>`，没有调用 DSH，也没有 commit、merge、push 或删除 worktree。

## 结果

- Adapter execution：`passed`
- Review：`changes-requested`
- Duration：58,595 ms
- Usage：29,277 input、13,056 cached input、735 output、112 reasoning output tokens
- Failure reasons：无
- stderr：0 字节
- Canonical review：`<temporary-review-smoke>/artifacts/review.json`

Codex review 发现：

1. P1 `review-001`：`src/window.mjs:2-4` 在参数验证前返回 disabled 窗口，导致无效 disabled 输入不抛出 `RangeError`。
2. P2 `review-002`：`tests/window.test.mjs:20-26` 缺少 disabled 无效输入回归测试。

两条 finding 都包含具体 evidence、最小修复要求和 `open` resolution，并通过 review schema 与 Runner 语义校验。

## 只读与审计证据

- smoke 前后 `package.json`、`src/window.mjs`、`tests/window.test.mjs` SHA-256 完全一致。
- smoke 前后 Git status 都只有相同的三个 untracked 路径。
- review 后 3/3 fixture tests 仍通过。
- JSONL 中唯一 command 是使用 `pwd`、`sed`、`find` 和 `nl` 读取 Contract、report、patch 与源码；exit 0。
- candidate 与 canonical `review.json` JSON 语义完全一致。
- artifacts 未出现 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 或测试用 secret marker。
- 本次 stderr 没有 state DB warning；这只说明该次运行未输出 warning，不能证明 CLI 没有读取本地 state。

## 结论

真实 adapter smoke 通过，可以进入新的 A2。仍需控制成本：真实小 fixture 的输入已经达到 29k tokens，因此 A2 必须避免把完整 stdout/stderr 重复嵌入 prompt，并记录每轮 usage。
