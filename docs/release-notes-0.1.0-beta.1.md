# 0.1.0-beta.1 release notes

> 状态：npm beta 已发布；尚未创建 GitHub tag/Release。

## 定位

`codex-dsh-bridge` 为 Codex 提供标准化、实时可见、正确 Workspace 分组的 DSH Web Host 通道。Codex 负责计划与 review，DSH 负责执行，Bridge 负责 session 生命周期、事件与结构化 evidence。

## 主要能力

- `codex-dsh web-run`：按 canonical project path 解析/创建 Workspace，通过同一 Web Host 创建 session，并在已打开的 DSH Web UI 中实时显示。
- `codex-dsh web-probe`：在任何 session mutation 或 prompt 前只读检查 DSH version、Host marker、RPC 与两条 WebSocket downlink。
- `codex-dsh web-runs`：只读查询本地不可变运行索引。
- fail-closed session coordinator：exactly-once prompt、event seq/history/running 对账、断线恢复、timeout、cancel 与 approval/question 阻断。
- guarded Runner：按需提供隔离 worktree、Git policy、路径边界、独立 checks、结构化 Codex review 与审计 artifacts。

## 安装

```bash
npm install --global codex-dsh-bridge@beta
codex-dsh --version
codex-dsh web-probe "/absolute/path/to/project"
```

Bridge 不安装 DSH。用户需要单独安装受支持版本并保持 `dsh web` 运行。

## 兼容性

- Node.js：`>=22.19`
- 已验证 DSH：`0.1.0-rc.8`、`0.1.1-rc.1`、`0.1.1-rc.2`
- 未知 DSH version：只读采样 capability，但阻断任务执行
- Host protocol marker：`0.0.1`

## 已知边界

- DSH 仍处于 developer preview，升级后必须重新运行 compatibility probe。
- `web-direct` 不是 sandbox，会让 DSH 在用户指定项目中直接工作。
- 当前 Web Host API 不提供 per-session environment/Skill patch；需要预防式 Git wrapper 或隔离 Skill catalog 时应使用 headless guarded Runner。
- loopback endpoint、路径核验与 Git wrapper 都不能替代 OS/container/network sandbox。
- 卸载 package 不会删除 `~/.dsh-bridge/runs`。
- 当前主实现是外部 Bridge CLI，不是由 `dsh plugin add` 管理的 Cordis plugin。
- Codex companion plugin 尚未发布；现阶段通过 CLI 与任务说明调用。

## 验证摘要

- 自动测试：94/94 通过。
- 真实 Web Host smoke：session 正确归入 Workspace，已打开 UI 无需刷新即可看到运行与完成状态。
- DSH rc.2 live compatibility probe：六项只读检查通过，未创建 session、未发送 prompt。
- npm registry 隔离安装：两个 binary、version、help、运行索引、Schema 与 Prompt 资源定位通过。
- npm integrity：`sha512-aYXDBPPGlns52ewgUsRQJuY7xxWMrxMi+tEPru2zW/Pj/R3/6R7qVvVjj2v7YraqxNktkgz+8/6uXOIRS7eYhw==`。
- npm Public Registry 首发自动创建了 `latest`；当前仍应显式安装 `@beta`，该 `latest` 不代表稳定承诺。

## 升级与卸载

```bash
npm install --global codex-dsh-bridge@beta
npm uninstall --global codex-dsh-bridge
```

升级后先运行 `codex-dsh web-probe`。卸载前如需删除 evidence，应由用户另行确认保留策略。
