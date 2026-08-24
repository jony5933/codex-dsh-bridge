# Bundled Codex CLI 非交互审阅协议探测

- 探测日期：2026-08-20
- CLI：`/Applications/ChatGPT.app/Contents/Resources/codex`
- 版本：`codex-cli 0.148.0-alpha.15`
- 目的：在接入 Runner 前验证 structured output、JSONL、final message、fail-closed 和超时清理前置条件

## 结论

协议探测通过，可以进入 opt-in adapter 实现，但不能把 bundled alpha CLI 当作稳定接口，也不能直接启用自动审阅。

推荐调用形态：

```text
codex --ask-for-approval never exec
  --ephemeral
  --ignore-user-config
  --ignore-rules
  --sandbox read-only
  --output-schema <review.schema.json>
  --json
  --output-last-message <candidate.json>
  <prompt>
```

全局 `--ask-for-approval never` 必须放在 `exec` 前；放在 `exec` 后会以 exit 2 拒绝。专用 `codex exec review` 也支持 `--output-schema`、`--json` 和 `--output-last-message`，而顶层 `codex review` 没有暴露这些选项。

## Fail-closed 证据

1. 错误参数顺序：exit 2，不产生审阅结果。
2. 不存在的 schema 路径：exit 1，请求模型前失败。
3. 不兼容 strict structured-output 的 schema：API 返回 `invalid_json_schema`，CLI exit 1，不产生 candidate。
4. 修正 schema 后：CLI exit 0，JSONL 包含 `thread.started → turn.started → item.completed → turn.completed`，final message 写入指定文件。
5. candidate 再经过本项目 `record-review` 校验，成功生成 worktree 外部的 `review.json`。

任何非零退出、timeout、缺少 `turn.completed`、缺少 final message、JSON 解析失败、schema 失败或 Runner 语义失败，都必须阻止 review 被接受。

## 成功样本

- 状态：`blocked`（明确标注只做协议探测，没有执行真实代码审阅）
- elapsed：约 21.3 秒
- usage：15,963 input tokens、70 output tokens
- 工具调用：无
- 临时 artifacts：`<temporary-review-probe>/`

即使使用 `--ephemeral`，CLI 仍会读取本地 state DB 并输出 `state db discrepancy` warning；因此 `ephemeral` 只能解释为“不保留可恢复 session”，不能解释为“不接触本地状态”。最小探测的 input token 也较高，未来必须记录 usage、限制 prompt 体积，并避免重复嵌入完整日志。

## 超时与进程树

Runner 已改为在 POSIX 上为命令创建独立 process group。timeout 时先向整个进程组发送 SIGTERM，5 秒后仍未退出才发送 SIGKILL，并在主进程 close 时取消强杀 timer。自动测试证明派生 grandchild 不会在 timeout 后继续运行。

Windows 尚未实现等价的进程树终止，本项目当前真实环境为 macOS；跨平台产品化前需要单独实现和验证。

## Adapter 进入条件

1. adapter 默认关闭，只能由明确配置启用；
2. 固定使用 Runner 维护的 reviewer prompt 与 schema；
3. 不加载用户 config、rules 或项目审阅规则；
4. read-only、never approval、ephemeral；
5. 原始 JSONL、stderr、final candidate 和 usage 全部保存到 worktree 外部；
6. fake CLI 测试覆盖非零退出、timeout、malformed JSONL、缺失完成事件、错误 candidate 和 schema/语义拒绝；
7. 明确评估 reviewer subprocess 的 environment 与本地 state/auth 访问边界。
