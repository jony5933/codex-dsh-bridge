# 安全策略

## 支持范围

本项目当前处于 beta 准备阶段，尚未发布稳定版本。维护者只对最新 beta 分支和最新 npm beta 进行安全修复；历史开发快照不承诺回补。

## 报告安全问题

请不要在公开 Issue、Discussion、日志或 DSH session 中披露未修复漏洞、API Key、Token、credentials、私有仓库内容或可复现的攻击载荷。

GitHub 仓库建立后，优先使用 GitHub Private Vulnerability Reporting。若该入口尚未启用，请通过维护者 GitHub profile 中提供的私密联系方式报告；在建立可靠私密渠道前，不要发送 secret 或完整敏感 evidence。

报告尽量包含：

- 受影响的 Bridge 与 DSH version；
- 使用的通道：`web-direct`、guarded `run` 或 Codex review adapter；
- 最小复现步骤和预期/实际行为；
- 是否发生文件、Git history、remote、credentials 或网络边界影响；
- 已做的临时缓解；
- 已脱敏的日志或 evidence。

维护者确认前请保留原始证据，不要公开发布，也不要自行测试不属于你的系统。

## 安全边界

- Web Host endpoint 只接受 loopback HTTP(S) origin，但这不等于 OS sandbox。
- `web-direct` 会授权 DSH 直接修改用户指定项目，适用于低风险且能立即 review 的任务。
- guarded Runner 提供 worktree、Git wrapper、路径核验与独立 checks，但不能保证阻断绝对路径工具或其他网络客户端。
- compatibility probe 会在 session mutation 与 prompt 前 fail closed；未知 DSH version 不执行任务。
- Bridge 不存储或复制 DSH API Key。DSH credentials 仍由本机 DSH 管理。
- 本地 evidence 可能包含项目路径、prompt、diff、命令和模型输出，应按源代码同等级别保护。
- 卸载 npm package 不会删除 `~/.dsh-bridge/runs`。

## 不属于漏洞的情况

- 文档已经明确说明的 developer-preview incompatibility；
- 用户主动选择 `web-direct` 后，DSH 在明确指定项目内产生的预期修改；
- 没有安全影响的性能差异、Token 使用量或 UI 展示问题；
- 仅针对已停止支持版本且不能在最新 beta 复现的问题。
