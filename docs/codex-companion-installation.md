# Codex 调用 Bridge

更新日期：2026-08-24

Codex companion plugin 尚未生成。当前最稳定的方式是先安装 Bridge CLI，再在任意 Codex task 中明确要求通过 `codex-dsh` 调用 DSH Web Host。

## 前置条件

1. 单独安装并配置受支持的 DSH。
2. 保持 `dsh web` 运行。
3. beta 发布后安装 Bridge：

```bash
npm install --global codex-dsh-bridge@beta
codex-dsh --version
codex-dsh web-probe "/absolute/path/to/project"
```

## 在 Codex 中发起任务

可以在 Codex task 中这样描述：

> 请先制定计划，然后通过 `codex-dsh web-run` 让 DSH 在当前项目执行。任务说明使用中文并保留英文技术词；禁止 commit/push。DSH 完成后读取 evidence、检查 Git diff 和 tests，再由 Codex review。发现问题时先报告，不自动返修。

Codex 应把本轮任务说明写入项目外的 UTF-8 Markdown 临时文件，再执行：

```bash
codex-dsh web-run "/absolute/path/to/project" "/absolute/path/outside/project/task.md"
```

CLI 会通过 canonical project path 把 session 放入正确的 DSH Workspace。已打开的 DSH Web UI 使用同一个 Host 事件源，因此可以实时看到 session，而不是统一进入 `Ungrouped`。

## 选择通道

- 低风险、一次性、可立即人工 review：使用 `codex-dsh web-run`。
- 需要 worktree、Git policy、独立 acceptance checks、路径边界或隔离 Skill catalog：从源码使用 guarded `run`，直到这些能力形成稳定的已安装 CLI Contract。
- prompt 已发送或可能被接受后，不得切换通道重发同一任务。

## Codex review

DSH 完成后，Codex 至少检查：

1. evidence 的 `status`、Workspace/session identity 与 terminal reason；
2. 目标仓库真实 Git diff；
3. 项目 tests、typecheck、lint 或任务约定 checks；
4. 是否存在越界修改、commit、push、依赖变化或敏感信息；
5. 是否应该接受、要求返修或判定 blocked。

`web-run` evidence 不能证明 guarded Runner 专属控制已启用。Codex 不应把 DSH 的完成声明当作最终正确性证据。

## 未来 companion plugin

真实 beta 稳定后，可以生成薄 Codex plugin：

- Skill：生成中文任务说明和选择通道；
- 命令入口：调用已安装的 `codex-dsh`；
- 依赖检查：Node、Bridge CLI、DSH Web Host；
- review 提示：读取 evidence、diff 和 checks。

plugin 不内嵌第二份 Web Host client，不保存第二套 session 状态，也不复制 Codex 已有的 Diff/Review UI。
