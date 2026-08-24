# DSH 0.1.1-rc.2 Web Host 兼容结论

- 验证日期：2026-08-24
- 本机 DSH：`0.1.1-rc.2`
- Host endpoint：`http://127.0.0.1:3080`
- 结论：**通过 Bridge 只读 compatibility probe，可加入当前验证支持集合。**

## 判断依据

1. PATH 中 `dsh --version` 返回 `0.1.1-rc.2`。
2. 全局 package 文件更新时间为 2026-08-24 11:37:29 +0800；监听 3080 的 `dsh web` 进程启动于 11:39:59，因此不是升级前遗留进程。
3. `host.describe` 返回 protocol marker `0.0.1`，provider/model 为 `openrouter / stealth/ox-alpha`。
4. `workspace.list` 验证 4 个 Workspace record，`session.list` 验证 37 个 session record。
5. `/api/events.mux` 与 `/api/events.host` 两条 WebSocket 均成功打开。
6. probe 明确记录没有创建 Workspace、没有创建 session、没有发送 prompt。

机器 evidence：[`compatibility.json`](validation-evidence-summary.md)。

## 兼容边界

- 支持集合是明确列举的版本，不使用宽泛 semver range；当前为 `0.1.0-rc.8`、`0.1.1-rc.1` 和 `0.1.1-rc.2`。
- 官方仍处于 Developer Preview。未知版本只允许执行相同的只读 capability probe，状态保持 `incompatible`，不能创建 session 或发送 prompt。
- `host.describe.version` 当前返回 `0.0.1`，它是 Host protocol marker，不是 npm package version。
- 现有 Host API 没有返回 package build identity，因此自动 evidence 只能把本机 CLI version 与 Host capability 作为两个独立信号，并记录 `sameProcessAsHost: unverified`。本轮通过进程启动时间晚于 package 安装时间补充了人工绑定证据；Bridge 不把这种本机诊断伪装成跨平台协议保证。
- rc.2 发布内容集中于 Files API 图像复用和图像预处理，没有改变本项目当前使用的 Web Host 表面；是否支持未来多模态附件仍单独规划。

## 后续升级规则

1. 新版本先保持未支持。
2. 运行自动 contract tests。
3. 对真实新版本 Host 执行 `web-probe`。
4. 必要时再做一次最小真实 session smoke。
5. 只有证据通过后更新明确支持集合；不得因 npm `latest` 自动放行。
