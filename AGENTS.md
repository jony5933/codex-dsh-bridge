# 代理操作指南

## 项目使命

本仓库用于为 Codex 提供一个标准化、实时可见、正确分组的 DSH Web Host 通道，并在需要时附加安全控制。必须保持以下职责分离：

- Codex 负责任务计划、任务说明、证据判断和代码 review。
- Web Host Bridge 负责 `Workspace` 解析、session 生命周期、实时事件和结构化 evidence。
- DSH 负责具体修改；`web-direct` 在用户指定项目执行，`web-guarded` 在 Runner 创建的 worktree 中执行。
- Runner 是按需安全策略层，负责隔离环境、独立检查、路径策略和审计文件，不是所有任务的默认入口。
- 最终是否接受、返修、合并、发布或放弃，由用户决定。

## 仓库定位

- `src/cli.ts`：命令行入口和实时终端输出。
- `src/version.ts`：从源码或已安装 package layout 读取 Bridge version，供 `--version` 使用。
- `src/runner.ts`：运行生命周期和结果报告。
- `src/acceptance.ts`：独立 acceptance checks 的外部路径验证与执行。
- `src/review.ts`：结构化 Codex review 的 schema 校验、状态语义和 artifact 记录。
- `src/reviewer/codex-cli.ts`：默认不自动运行的 Codex CLI review adapter、JSONL 验证和 usage 审计。
- `src/benchmark/dsh-session.ts`：只读解析 rc.8 concatenated Zstandard session 并汇总模型 usage。
- `src/harness/transport.ts`：Runner 与执行通道之间的内部 `HarnessTransport` 契约。
- `src/harness/headless.ts`：DSH 指令构造与默认 `HeadlessTransport` 实现。
- `src/harness/web-host/client.ts`：rc.8 loopback HTTP RPC 与双 WebSocket 下行协议 client；不包含 session 成功判定。
- `src/harness/web-host/session.ts`：Web Host session 状态机、event seq 与最终 history 核验；由 CLI `web-run` 通过独立 `WebHostTransport` 使用，不伪装为 Runner process transport。
- `src/harness/web-host/transport.ts`：`web-direct / web-guarded` 的 Web Host transport 包装与原生 session evidence；不得伪造 process `exitCode`。
- `src/harness/web-host/command.ts`：`web-run` 参数、artifact root 前置边界检查和持久 evidence；artifact 禁止写入目标项目。
- `src/harness/web-host/compatibility.ts`：prompt 前的 DSH version、只读 RPC 与双 WebSocket capability probe；未知版本或 schema 必须 fail closed。
- `src/harness/web-host/index.ts`：并发安全的不可变运行索引与 `web-runs` 只读查询；按 project、Workspace、session、状态和时间筛选。
- `src/harness/web-host/workspace.ts`：canonical path 的 Workspace 解析/创建，以及 session 归属核验。
- `docs/web-host-bridge-direction.md`：双模式、Workspace 分组、最小权限面和 MVP 验收的方向决策。
- `docs/distribution-strategy.md`：GitHub/npm、DSH/Cordis 与 Codex companion 的发布边界；发布前禁止复制核心 transport。
- `docs/package-installation.md`：npm package/bin、安装、更新、卸载、tarball allowlist 与后续拆包门槛。
- `docs/release-checklist.md`：GitHub/npm beta 的 release gates、隐私审计、验证、发布与发布后步骤。
- `docs/codex-companion-installation.md`：在 companion plugin 尚未生成时，让 Codex 调用已安装 Bridge CLI 的标准方式。
- `docs/release-notes-0.1.0-beta.1.md`：首个 beta 的待发布 release notes；发布前必须与最终 tag、兼容证据和 package metadata 对账。
- `docs/validation-evidence-summary.md`：可公开的脱敏验证结论；不包含原始 prompt、JSONL、patch、模型输出或本机绝对路径。
- `scripts/release-audit.mjs`：扫描公开候选文件中的私有树、本机路径、environment file、私钥头和常见 Token pattern。
- `scripts/create-release-snapshot.mjs`：在仓库外的新目录生成不含旧 Git history 和私有归档的 release snapshot；禁止覆盖已有目标。
- `src/skills.ts`：外部 DSH Skill root 校验、bundle hash、artifact 投影和 Harness-only 环境注入。
- `src/lib/command.ts`：无 shell 子进程执行和实时输出回调。
- `src/git/`：仓库、worktree、diff 和路径边界操作。
- `contracts/task.schema.json`：任务契约的权威 schema。
- `contracts/repair.schema.json`：只允许追加 review findings 的返修 overlay schema。
- `contracts/review.schema.json`：`approved / changes-requested / blocked` 审阅结果的权威 schema。
- `contracts/result.schema.json`：Runner `passed / failed / blocked` 结果及其 artifact 状态约束。
- `contracts/direct-evidence.schema.json`：直接调用 DSH 基准的证据 schema，明确记录其手动检查与缺少的 Runner controls。
- `contracts/examples/`：可复用的安全示例，不得写入本机专属路径。
- `.private-release-archive/`：被 Git ignore 的本地私有原始 evidence 与真实运行 Contract；不得进入公开 release snapshot 或 npm package。
- `prompts/executor.md`：发送给执行代理的操作规则。
- `prompts/reviewer.md`：只供独立 Codex reviewer 使用的固定审阅协议，禁止发送给 DSH。
- `tests/`：使用临时仓库和假 Harness 的 Runner 测试。
- `docs/validation-plan.md`：实验设计和评分标准。
- `ROADMAP.md`：当前状态、证据、进入门槛和后续工作。

## 标准工作流程

1. 修改编排逻辑前，先阅读 `ROADMAP.md`、`docs/web-host-bridge-direction.md` 和相关任务契约。
2. 保持修改范围精简，并保留用户已有工作；初始基线 commit 为 `6132189`，其后的未提交内容不得擅自覆盖或清理。
3. 手动修改源码和文档时使用 `apply_patch`。
4. 修改代码后运行 `pnpm run check`。
5. 真实 DSH 验证必须使用专门的目标仓库和固定的 `baseCommit`。
6. 宣布成功前，必须检查 `result.json`、`changes.patch`、必需检查结果和路径边界结果。
7. 提议接受修改前，必须由 Codex 审阅生成的 worktree 或 patch。
8. 只有新证据改变了进度或风险状态时，才更新 `ROADMAP.md`。
9. 返修必须引用父 Contract，禁止重新复制完整 Contract；自动返修最多两轮。
10. 行为基准需要防止执行代理改写时，使用目标仓库与 worktree 外部的 `acceptanceChecks`。
11. Codex CLI review 只能通过显式 `codex-review` 命令启用；普通 Runner `run` 不得自动触发 reviewer。
12. 通道效率基准必须保存相同 prompt 的 hash，并分开报告 DSH、Codex review、确定性检查和编排耗时；单次配对不得宣称因果结论。
13. 日常推荐入口是 `web-run` 的 `web-direct`；只有任务明确需要隔离、Git policy、独立 checks、路径边界或完整审计时才选择 guarded Runner。`run` 仍显式使用 `HeadlessTransport`，两种入口不得在 prompt 接受后自动互相 fallback。

## 安全约束

- `web-direct` 允许 DSH 修改用户明确指定的项目目录；不得把这个授权扩展到其他目录。`web-guarded` 禁止让 DSH 直接修改目标仓库的主工作目录。
- 除非用户单独明确授权，否则禁止 commit、merge、push、创建 tag、删除 worktree 或修改 Git 配置。
- 除非用户单独明确授权，否则禁止执行 `npm publish`、改变 dist-tag 或全局安装/卸载 package。
- 许可证、copyright holder、公开 repository URL 与原始 evidence 的公开策略必须由维护者确认，不得由 Agent 猜测。
- 已归档 evidence 保持不可变；若不适合公开，应完整保留在私有归档并发布脱敏 summary，不得直接改写原始证据制造“已脱敏”假象。
- Harness 失败、运行超时、必需检查失败或发生路径越界时，禁止将任务判定为成功。
- baseline 前置条件失败必须返回标准 `result.json` 的 `blocked` 状态；不得启动 Harness，也不得生成或伪造 patch。
- `forbiddenPaths` 的优先级高于 `allowedPaths`。
- `requiredChecks` 是可信 shell 命令；禁止执行来源不可信的任务契约。
- `acceptanceChecks` 的脚本和 fixtures 必须位于目标仓库与执行 worktree 外部，且同样只能来自可信任务契约。
- 外部 `skills.root` 必须位于目标仓库与执行 worktree 外部；bundle 禁止 symlink，只有声明的 Skill 可以进入 artifact 投影和 DSH catalog。
- 正式无 Skill 基线必须使用空 `skills.names` 和生成的隔离 patch，不能仅省略 `skills` 后假定本机没有默认 Skill；Harness 后投影或 patch hash 变化必须使 run 失败。
- `baselineChecks`、`requiredChecks` 与 `acceptanceChecks` 只能接收非敏感环境变量白名单；不得把宿主 API Key、Token、DSH session 或 SSH agent 转发给检查进程。
- 路径检查是检测措施，不是操作系统级 sandbox，不得描述为完整隔离。
- Git wrapper 也不是网络 sandbox；不能声称它能阻止绝对路径 Git 或其他网络客户端造成的外部写入。
- 审计文件必须保存在执行 worktree 外部，防止执行代理隐藏或覆盖记录。
- `stdout` 只输出最终 JSON；生命周期事件和实时 DSH 输出写入 `stderr`。
- npm beta 保持单包 `codex-dsh-bridge`；主要 binary 为 `codex-dsh`，兼容 alias 为 `deepseek-loop`。DSH 必须保持独立前置条件，不得由 Bridge 自动安装或复制 credentials。
- 发布 tarball 必须继续使用 `package.json#files` allowlist，并由 `prepack` 执行完整检查；测试、真实 evidence、本地 Contract 和源码不得意外进入包内。
- DSH 的完成声明不是成功证据；真实 Git diff 和 Runner 独立检查才是权威结果。
- `headless` Harness 环境必须启用 Git policy wrapper，拒绝并审计标准 `git commit` / `git push`；Harness 后必须比较 HEAD 与 refs，任何变化都使 run 失败。
- rc.8 Web Host `session.create` 没有 per-session environment 或 Skill patch 参数；`web-guarded` 不得声称启用了 Git wrapper 或隔离 Skill catalog。它只能把 Git ref audit、checks、boundary 和 artifacts 标为调用方后置责任；需要预防式进程环境控制或外部 Skill 注入的任务必须继续使用 `headless`，或在未来获得明确 Host capability 后再接入。
- Harness、checks 和 reviewer CLI 超时必须终止整个派生进程组；不得只杀主 PID 后留下后台子进程。
- Web Host transport 只有在确认 `session.prompt` 尚未发出时才允许切换通道；一旦请求已发出，即使 `accepted: true` 响应丢失也属于接受状态不确定，断线、timeout、approval 或 question 必须 fail closed，禁止用 headless 重做同一 prompt。
- WebSocket 重连必须用 `session.history` 与 event `seq` 补偿并核对终止状态；`reportDelivery` 和进程内 Job status 不得作为 Runner 成功凭据。
- Web Host RPC 使用最小 allowlist。M7 分组只允许增加 `workspace.list/create`；禁止开放 settings、credentials、filesystem、Workspace 删除或 session 删除。
- `web-run` 必须在任何 Workspace/session mutation 与 prompt 前完成 compatibility probe；未知 DSH version 可以只读采样 capability，但不得执行任务。`host.describe.version` 是 protocol marker，不得冒充 npm package version。
- session 创建前必须把 canonical project path 解析为 `workspaceId`，并使用 `workspaceId + sessionId` 创建和核验归属；禁止把只传 `cwd`、落入 `Ungrouped` 的行为视为成功。
- 历史 `Ungrouped` session 不得自动迁移、删除或批量归档；`Ungrouped` 是虚拟分组，不是可删除 Workspace。
- 任何 reviewer 非零退出、timeout、无效 JSONL、缺失完成事件、candidate/schema/语义错误都必须 fail closed，且不得覆盖已有 `review.json`。
- `codex-review` 不得对没有 patch 的 run 级 `blocked` 报告启动模型审阅。
- reviewer 必须先校验 Runner result 或 direct-channel evidence，再使用中性的 execution evidence prompt；禁止把某个通道没有执行的 control 写成已验证。

## 任务契约要求

一份合格的任务契约必须包含：

- 一个具体目标；
- 实验使用不可变或明确固定的 `baseCommit`；
- 范围较窄的 `allowedPaths` 和明确的 `forbiddenPaths`；
- 可观察、可测试的验收条件；
- 独立的 `requiredChecks`；
- 仅在执行前必须健康时声明 `baselineChecks`；任务目标要修复的失败测试不得作为 baseline blocker；
- 对关键兼容性或行为保持要求，提供外部 `acceptanceChecks`；
- 每个 `acceptanceChecks[].id` 必须唯一，禁止用同一 identity 表示多个检查定义；
- 在任务不需要时，明确禁止 commit、push、依赖变更和范围扩张。

发送给 DSH 的执行协议、目标、验收条件和补充说明使用中文描述，并保留必要的英文技术词、命令、字段名和代码标识符。

如果需求互相冲突，或解决方案必须修改禁止路径，应报告 `blocked`，不得弱化测试或自行扩大范围。

返修 overlay 只能包含新的 `taskId`、`parentContract`、连续的 `iteration` 和结构化 `findings`。Runner 必须自动继承原始 Contract 的所有执行与验收字段（包括 `acceptanceChecks` 与 `skills`），并在 `result.json` 中记录完整 lineage history。

## 测试要求

- 命令实时输出必须通过不依赖真实 DSH 安装的单元测试。
- Runner 集成测试使用假 Harness 和临时 Git 仓库。
- 至少保留一项测试，证明项目内 checks 通过时，外部 acceptance check 仍能发现行为漂移。
- 至少保留一项测试，证明目标仓库主工作目录不会被修改。
- 至少保留一项测试，证明路径越界会让运行失败。
- 真实 DSH 冒烟测试是自动测试的补充，不能替代自动测试。
- Skill 实验必须从同一仓库状态开始，并使用相同验收条件；唯一变量只能是 Skill。
- Skill 注入测试必须证明只有 Harness 收到 `DSH_BUNDLED_SKILL_DIR`，checks 不继承，并拒绝仓库内 root 和 bundle symlink。

## 审阅结果

审阅结果统一分为：

- `approved`：检查和边界验证通过，且不存在尚未解决的可执行问题；
- `changes-requested`：任务本身仍在范围内，但 patch 存在需要修复的问题；
- `blocked`：任务契约矛盾、缺少必要授权，或无法安全执行。

每条审阅问题必须包含严重度、文件位置、证据和最小修复要求。自动返修循环必须设置明确的最大轮数。

## 本地维护环境

- 下述名称均为脱敏占位符：`<bridge-repository>`、`<validation-repository>`、`<ant-design-validation-repository>`。
- 当前本机 DSH 与 npm `latest` 均为 `0.1.1-rc.2`；活跃 Contract 使用 PATH 中的 `dsh`，不依赖易失的 npx cache 绝对路径。
- DSH Web UI 可以继续运行；日常推荐入口是 `web-run` 的 `web-direct`。高约束任务使用 `run` 的 guarded `HeadlessTransport`；当前不把缺少 per-session environment/Skill patch 的 Web Host 冒充为完整 guarded Runner。
- `~/.nvm` 已安装 Node 24.19，`~/.zprofile` 会为登录 shell 加载 nvm；交互式和非交互式登录 shell 均已验证使用 Node 24.19。
- 项目通过 `.nvmrc` 固定 Node 24.19；运行项目命令前可执行 `nvm use`。
- 本地 DSH 凭据由 `~/.dsh/.credentials.yaml` 统一管理，Web 和 `headless` profile 共用；禁止将 API Key 复制到任务契约、prompt、日志或仓库文件。
- 系统临时目录中的审计文件不是永久存储。
