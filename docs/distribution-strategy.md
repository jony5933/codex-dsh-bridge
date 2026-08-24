# 发布与插件形态决策

更新日期：2026-08-24

## 结论

项目采用“一个核心、两个适配面”的发布结构：

```text
GitHub / npm：Codex → DSH Bridge 核心
  ├─ DSH / Cordis 适配面：主要生态入口
  └─ Codex plugin：可选的薄客户端与使用入口
```

如果首发只能选择一种插件形态，优先选择 **DSH / Cordis 生态形态**。Codex plugin 后置，且只包装调用体验，不复制 Web Host client、session coordinator、evidence 或安全策略。

## 为什么主要面向 DSH

- 产品的硬依赖是 DSH Web Host：`Workspace`、session、mux/host events、history 和 cancel 都来自 DSH。
- 没有运行中的 DSH Web Host，本项目没有可执行对象；因此真实用户首先是 DSH 用户，而不是所有 Codex 用户。
- DeepSeek Harness 官方仓库明确说明 “Everything is a Plugin”，提供 Cordis plugin 教程，并建议第三方插件仓库使用 `dsh-plugin` GitHub topic 获得生态内可发现性。
- DSH 当前仍处于 developer preview，存在 breaking changes。长期把兼容层放在 DSH/Cordis 适配面，比让 Codex plugin 直接依赖未稳定的内部 Host API 更容易维护。

## Codex plugin 的正确职责

Codex plugin 适合作为可选 companion，提供：

- 一个 Skill：识别“调用 DSH 执行”的意图，生成中文任务说明并保留英文 technical terms；
- 一个稳定命令入口：调用已经安装的 Bridge CLI 或 MCP server；
- 结果回传说明：告诉 Codex 从 evidence、目标 diff 和 checks 进行 review；
- 安装前检查：确认 Node、Bridge CLI 和本机 DSH Web Host 可用。

Codex plugin 不应该：

- 内嵌第二份 Web Host protocol 实现；
- 自己保存另一套 Workspace/session 状态；
- 重复建设 Codex 已有的 diff/review UI；
- 假设安装 Codex plugin 就等于安装或启动 DSH。

当前官方 OpenAI documentation 能确认 Codex 适合使用可组合 CLI 和 Skill，但没有查到面向 GitHub 作者的公共 Codex plugin marketplace 发布流程。因此首发不把 Codex 官方曝光作为获客前提；Codex companion 可以先通过 GitHub 安装说明、personal/team marketplace 或本地 plugin 方式提供。

## Cordis plugin 的边界

首发也不应立刻把全部 Bridge 搬进 DSH 进程。现有外部 CLI 已完成真实 Web Host smoke，保留它有三个好处：

- Codex 可以独立发起、等待和保存 evidence；
- Bridge 崩溃不会直接扩大 DSH Host 的进程内故障面；
- 在 DSH developer preview 期间，协议 adapter 可以独立发版。

Cordis plugin 只有在以下需求出现时才增加：

- 需要 DSH 内部稳定 service 代替当前未版本化的 Host API；
- 需要 DSH UI 中的 Bridge 配置、运行状态或兼容性提示；
- 需要由 DSH 官方 loader 管理生命周期、更新和依赖注入。

因此更准确的首发名称是 **Codex → DSH Web Host Bridge**；仓库使用 `dsh-plugin` topic，但 README 必须注明当前主实现是外部 Bridge CLI，Cordis host package 属于兼容适配层而不是整个产品。

## M8 beta 包边界

首个 beta 保持一个 npm package：`codex-dsh-bridge@0.1.0-beta.1`。主要 binary 为 `codex-dsh`，`deepseek-loop` 仅作为既有脚本的兼容 alias。DSH 是独立前置条件，不由 Bridge 安装，也不声明为 package dependency 或 peer dependency。

CLI、协议 adapter、evidence 和 guarded Runner 当前共享内部模块，尚无需要独立版本化的公共 core API。因此以下 monorepo 结构是长期候选，不是 M8 beta 的现状。安装、更新、卸载、tarball allowlist 与拆包门槛见 `docs/package-installation.md`。

## 长期候选仓库结构

```text
packages/
  bridge-core/          Web Host client、session coordinator、evidence
  bridge-cli/           Codex 和人工都可调用的 CLI
  dsh-cordis-adapter/   可选 Host-side adapter，稳定后再启用
plugins/
  codex-dsh-bridge/     可选 Codex companion：Skill + scripts/MCP 声明
docs/
  protocol/             DSH 版本兼容与真实 smoke evidence
```

M8 不进行 monorepo 迁移。只有真实消费者或 Cordis host 权限边界证明有必要时再拆包，避免为了目录形态制造无效重构。

## 发布顺序

1. 稳定独立 CLI 与 evidence schema。
2. 增加 DSH version/capability probe，并对支持版本 fail closed。
3. 发布 GitHub beta，添加 `dsh-plugin` topic，提供 npm/源码安装。
4. 根据 DSH 官方 plugin loader 的稳定程度决定是否发布 Cordis adapter。
5. 最后生成 Codex companion plugin，只保存 Skill、命令入口和依赖检查。

## 参考

- DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness>
- DSH first plugin：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md>
- OpenAI Codex use cases：<https://developers.openai.com/codex/use-cases>
