# 贡献指南

感谢参与 Codex → DSH Web Host Bridge。

## 开发环境

需要 Node.js `>=22.19` 与 pnpm。只有真实 Web Host smoke 才需要单独安装并启动受支持的 DSH；单元测试不得依赖真实 DSH、API Key 或网络。

```bash
nvm use
pnpm install
pnpm run check
```

## 修改原则

- 保持 Codex 计划/review、Bridge 编排、DSH 执行三者职责分离。
- 日常入口为 `web-direct`；需要隔离、边界、独立 checks 或完整审计时使用 guarded Runner。
- 不复制 DSH credentials，不把 API Key 写入 Contract、prompt、测试、日志或 evidence。
- 不把路径检查、Git wrapper 或 loopback endpoint 描述成完整 sandbox。
- prompt 一旦可能被 Host 接受，就不得 fallback 后重发同一任务。
- 新增 RPC 必须说明最小权限理由，并补充 fake Host 的成功与 fail-closed 测试。
- DSH version/capability 变化必须先更新 compatibility tests，再进行只读 live probe。
- 用户可见文档使用中文说明，保留必要的英文技术词、命令和标识符。

## 测试要求

提交 Pull Request 前运行：

```bash
pnpm run check
npm pack --dry-run --json --ignore-scripts
```

涉及 Web Host 的修改至少覆盖：

- 请求/响应 schema 与 correlation；
- exactly-once prompt；
- event seq、history 与 terminal state 对账；
- timeout、断线、approval/question 和 cancel；
- Workspace canonical path 与正确分组；
- 未知 DSH version 的只读采样和执行阻断。

## Pull Request

PR 说明应包含：

- 修改目标和范围；
- 关键设计选择与安全影响；
- 已运行的 checks；
- 是否运行真实 DSH smoke；若运行，提供脱敏 evidence；
- 已知限制和兼容版本。

不要提交真实 credentials、用户私有源码、未脱敏绝对路径或不应公开的原始 session。不要在贡献过程中自动 commit、push、创建 tag、发布 npm package 或改变 dist-tag。

## 发布

发布只由维护者按 `docs/release-checklist.md` 执行。贡献 PR 不应修改版本号或生成 release tag，除非维护者明确要求。
