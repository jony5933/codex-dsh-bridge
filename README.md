# Codex → DSH Web Host Bridge

[GitHub](https://github.com/jony5933/codex-dsh-bridge) · MIT License

本项目的核心价值是：**为 Codex 提供一个标准化、实时可见、正确分组的 DSH Web Host 通道，并在需要时附加安全控制。**

目标工作流是：

1. Codex 生成计划和中文任务说明，保留必要的英文技术标识。
2. Bridge 根据项目路径解析或创建 DSH `Workspace`，并通过同一个 Web Host 创建 session。
3. DSH Web UI 无需重新载入即可显示 session、运行状态和输出，session 归入正确的 `Workspace`，而不是 `Ungrouped`。
4. DSH 执行具体修改，完成证据返回 Codex。
5. Codex 在自己的代码变化界面中执行 review。

Bridge 提供两种模式：

- `web-direct`：日常推荐模式。直接在用户指定项目中运行，优先保证低开销、实时可见和正确分组。
- `web-guarded`：按需安全模式。在 Web Host 通道外附加 Task Contract、隔离 worktree、Git policy、独立 checks、路径边界和审计 artifacts。

现有安全 Runner 是已经验证的可复用策略层，不再被定位为所有任务的默认入口，也不以“比直接调用更快或更省 Token”为卖点。M7 已通过真实 Web Host smoke：已打开的 DSH UI 无需刷新即可显示正确 Workspace 下的新 session、运行状态和输出。详细方向见 `docs/web-host-bridge-direction.md`，进度见 `ROADMAP.md`。

## 安装

当前仓库准备发布 `codex-dsh-bridge@0.1.0-beta.1`，但尚未执行 npm publish。正式发布 beta 后，推荐全局安装：

```bash
npm install --global codex-dsh-bridge@beta
codex-dsh --version
```

Bridge 不会代替用户安装或升级 DSH。使用前需要单独安装受支持的 `dsh`，并让 `dsh web` 在本机运行；当前已验证的 DSH 版本为 `0.1.0-rc.8`、`0.1.1-rc.1` 与 `0.1.1-rc.2`。Node.js 需要 `>=22.19`。

若只在单个项目内使用，发布后也可以安装为开发依赖，并通过 `npx codex-dsh` 调用：

```bash
npm install --save-dev codex-dsh-bridge@beta
npx codex-dsh --version
```

从源码运行：

```bash
nvm use
pnpm install
pnpm run check
```

更新 beta：

```bash
npm install --global codex-dsh-bridge@beta
codex-dsh web-probe "/absolute/path/to/project"
```

卸载 CLI：

```bash
npm uninstall --global codex-dsh-bridge
```

卸载不会删除 DSH，也不会自动删除 `~/.dsh-bridge/runs` 中的本地 evidence 与运行索引。完整安装、升级、卸载和发布边界见 `docs/package-installation.md`。

## 推荐入口：web-direct

先把 Codex 生成的中文任务说明保存为 UTF-8 Markdown 文件，例如 `/tmp/dsh-task.md`，然后运行：

```bash
codex-dsh web-run "/absolute/path/to/project" /tmp/dsh-task.md
```

从源码开发时，把以下示例中的 `codex-dsh` 替换为 `pnpm dev --` 即可。兼容旧脚本的 `deepseek-loop` binary alias 暂时保留，但新文档和自动化应统一使用 `codex-dsh`。

`web-run` 连接本机 `http://127.0.0.1:3080`，按项目 canonical path 解析或创建 Workspace，在该 Workspace 中创建 session，并订阅 DSH Web Host 的 mux/host 事件。已打开的 DSH UI 会通过同一 Host 实时显示该 session，无需重新载入。

命令会把 evidence 持久保存到 `~/.dsh-bridge/runs/<date>/<sessionId>/evidence.json`，同时写入不可变运行索引 `~/.dsh-bridge/runs/index/<date>/<sessionId>.json`；`stdout` 输出会包含 `evidencePath` 与 `indexPath`，不再要求 shell redirect。`completed / failed / blocked`、Workspace/session identity、event seq、terminal reason 和 reconnect 次数都会保留。Web 通道没有 process `exitCode`，因此 evidence 不会伪造该字段。非 `completed` 状态会让 CLI 返回非零进程状态。

可以显式覆盖本机 Host、全程 timeout 和 artifact root：

```bash
codex-dsh web-run "/absolute/path/to/project" /tmp/dsh-task.md \
  --endpoint http://127.0.0.1:3080 \
  --timeout-ms 1800000 \
  --artifact-root "/absolute/path/outside-project/runs"
```

endpoint 仍由 client 强制限制为 loopback HTTP(S) origin；timeout 必须位于 1 毫秒至 24 小时之间。artifact root 会在 prompt 发送前 canonicalize、创建并确认位于目标项目之外，预检失败时不会创建 DSH session。evidence 使用同目录临时文件和原子 hard link 发布，已有同名文件不会被覆盖。

每次 `web-run` 都会先执行只读 compatibility probe：核对 PATH 中的 DSH CLI version、`host.describe` 协议标记、`workspace.list`、`session.list` 以及 mux/host 两条 WebSocket。任一检查失败时会在创建 Workspace/session 和发送 prompt 前阻断，并保存 `compatibility.json`。当前验证支持 `0.1.0-rc.8`、`0.1.1-rc.1` 与 `0.1.1-rc.2`；未知版本仍会完成只读 capability 采样，但不能执行任务。

也可以只做探测，不创建 session：

```bash
codex-dsh web-probe "/absolute/path/to/project"
```

`host.describe.version` 当前是 Host protocol marker `0.0.1`，不是 npm package version；evidence 会把两者分开记录，并明确标注本机 CLI 与运行中 Host 的同进程关系无法由现有 API 自动证明。

使用只读命令查询本地运行索引；它不会连接 DSH，也不会创建、修改或删除 session：

```bash
codex-dsh web-runs \
  --project "/absolute/path/to/project" \
  --status completed \
  --since 2026-08-01T00:00:00Z \
  --limit 20
```

可用筛选项为 `--project`、`--workspace`、`--session`、`--status`、`--since`、`--until` 和 `--limit`；需要查询非默认位置时增加 `--artifact-root`。结果按 `startedAt` 倒序返回。失败发生在 Workspace 确认前时，索引中的 `workspaceId` 为 `null`，不会虚构归属。

当前命令固定为 `web-direct`。它直接允许 DSH 在指定项目中工作，适合低风险、人工可立即检查的任务；请在 prompt 中明确允许范围、禁止 commit/push、验收条件和停止条件。需要隔离 worktree、外部 acceptance checks、路径边界、Git wrapper 或隔离 Skill catalog 时，继续使用下面的 guarded Runner。rc.8 Web Host 不支持 per-session environment/Skill patch，因此这些预防式控制不能被 Web evidence 冒充为已启用。

## 现有 guarded Runner

复制 `contracts/examples/safe-change.json`，将 `repository` 设置为已有 Git 仓库，并按任务调整允许范围和验收条件：

```bash
pnpm dev -- run ./my-task.json
```

`run` 当前显式使用 `HeadlessTransport`；不会在 prompt 已被 Web Host 接受后自动 fallback 或重发同一任务。

以下命令保留为高约束任务的现有能力。Runner 会在系统临时目录中创建独立 worktree 和任务分支，调用配置好的 DSH 命令，执行必需检查，并生成以下审计文件：

- `prompt.md`：发送给 DSH 的完整任务指令；
- `harness.stdout.log`、`harness.stderr.log`：DSH 标准输出与错误输出；
- `git-policy/`：Harness Git wrapper、被拒绝命令日志与完整性证据；
- `changes.patch`：本次代码变化；
- `result.json`：统一的结构化运行报告，包含 `passed / failed / blocked` 状态、baseline、required checks、独立 acceptance checks 和 Contract lineage；

其中 `changes.patch`、Harness 日志和 Git policy 证据仅在 Harness 实际启动后生成。

运行期间，生命周期事件和 DSH 输出会实时写入 `stderr`；最终 JSON 报告单独写入 `stdout`，方便调用方解析或重定向。报告中的 `worktree` 路径可以直接交给 Codex 审阅。

## 记录 Codex review

Codex 独立审阅后，只生成符合 `contracts/review.schema.json` 的候选 JSON，并将它保存在执行 worktree 外。随后运行：

```bash
pnpm dev -- record-review ./artifacts/result.json ./review-candidate.json
```

Runner 会绑定 `runId` 与 `taskId`，检查 `approved / changes-requested / blocked` 状态语义、finding 唯一 ID、文件位置、证据、最小修复和解决状态，再把标准化结果写为与 `result.json` 同目录的 `review.json`。固定审阅协议位于 `prompts/reviewer.md`；它不发送给 DSH。

也可以显式启动 bundled Codex CLI adapter：

```bash
pnpm dev -- codex-review ./artifacts/result.json /Applications/ChatGPT.app/Contents/Resources/codex
```

该命令固定使用 never approval、read-only sandbox、ephemeral、忽略用户 config/rules、structured output 和 JSONL 审计。普通 `run` 不会自动调用 Codex reviewer；已有 `review.json` 也不会被覆盖。它既接受正式 Runner `result.json`，也接受符合 `contracts/direct-evidence.schema.json` 的直接通道 evidence；review prompt 会明确标记 channel 和实际 controls。当前 bundled CLI 是 App 内部 alpha 版本，真实项目启用前仍应先做一次专门 smoke test。

## DSH session 计量

DSH rc.8 默认把 session 保存为 concatenated Zstandard frames。可以只读汇总其中每次最终 `assistant/message` 的模型与 Token usage：

```bash
pnpm dev -- dsh-session-metrics ~/.dsh/sessions/<project>/<session>/session.jsonl.zstd
```

命令不会输出 prompt、推理正文或 tool result，只汇总模型调用数、input、cached read、output、reasoning tokens 以及 event/frame 数量。它用于通道基准审计，不会修改 DSH session。

## 返修 Contract

返修不能重新复制或改写完整任务 Contract，只能使用 repair overlay：

```json
{
  "version": 1,
  "taskId": "example-safe-change-repair-1",
  "repair": {
    "parentContract": "./safe-change.json",
    "iteration": 1,
    "findings": [
      {
        "id": "preserve-error-shape",
        "severity": "P2",
        "title": "保持既有错误响应结构",
        "description": "实现改变了原有 API Contract，需要按审阅要求修复。"
      }
    ]
  }
}
```

Runner 会自动继承父 Contract 的 `objective`、`baseCommit`、路径边界、`acceptanceCriteria`、`baselineChecks`、`requiredChecks`、`acceptanceChecks`、`skills`、Harness 和 execution 配置。Overlay 出现这些字段会被 schema 拒绝；`iteration` 必须连续且最多为 2。完整示例见 `contracts/examples/repair-overlay.json`。

## 外部 DSH Skill 注入

Skill 配对实验可在根 Contract 中声明可信的外部 Skill root：

```json
{
  "skills": {
    "root": "../skills",
    "names": ["ant-design-admin"],
    "invocation": "explicit"
  }
}
```

`root` 相对于根 Contract 所在目录解析，必须位于目标仓库和 execution worktree 外。Runner 会拒绝 symlink，使用标准 YAML 解析并核对每个 `<root>/<name>/SKILL.md` 的 `name` 与非空 `description`，再对 bundle 内全部常规文件按相对路径和内容计算确定性 SHA-256。

Runner 只把 `names` 声明的 bundle 复制到 worktree 外的 artifact 投影目录，并生成 `skills.patch.yml`，把 `skill-filesystem.includeDefaultRoots` 固定为 `false`、`customSkillDirs` 固定为该投影目录。配置 `skills` 时，`harness.args` 必须包含 `{skillPatch}`；Runner 会替换为生成的 patch 路径。只有 Harness 子进程收到 `DSH_BUNDLED_SKILL_DIR`，`requiredChecks`、`acceptanceChecks` 和 Codex review 不继承该变量。

`explicit` 会在 DSH prompt 中加入 `/name`；`automatic` 只提供 catalog，由模型按 description 选择。`result.json` 记录隔离状态、调用方式、canonical source/staged root、生成 patch 及其 hash、每个 bundle 的 hash/文件数和 Harness 后完整性复核结果；Skill 正文和源路径不会写进目标 patch。若 Harness 改写投影成员、bundle 或生成 patch，run 会 fail closed。

正式无 Skill / 有 Skill 配对必须保持 repository、`baseCommit`、任务目标、验收条件、checks、模型和超时相同。为排除本机项目级或用户级 Skill 污染，B1 应配置 `"skills": { "names": [] }` 并使用同一 `{skillPatch}` 参数；B2 只增加 `root`、目标 `names` 和 invocation。返修 overlay 会不可变继承原始 `skills` 配置。完全省略 `skills` 只用于兼容普通 Runner 任务，不代表隔离的无 Skill 实验。

## 独立验收检查

`baselineChecks` 是可选的执行前健康检查，只能用于“开始修改前就必须通过”的前置条件：

```json
{
  "baselineChecks": [
    "npm run test:baseline"
  ]
}
```

Runner 在隔离 worktree 中、DSH 启动前运行这些可信 shell 命令。任一检查失败时，Runner 不启动 Harness，也不生成 patch，而是返回并写入标准 `result.json`：`status` 为 `blocked`，`blockers` 保存原因，baseline 保存完整检查证据，未执行的 `harness`、`skills`、`gitPolicy` 和 `patchPath` 明确为 `null`。该报告受 `contracts/result.schema.json` 约束；`failed` 只表示 Harness 已执行后的进程、验证或策略失败。任务目标本身需要修复的失败测试不得放入 `baselineChecks`，应继续放在 `requiredChecks` 或独立 `acceptanceChecks` 中。

`requiredChecks` 在执行 worktree 中运行，适合项目自身的 test、typecheck 和 lint。对于不能由 DSH 改写的行为基准，可在根 Contract 增加 `acceptanceChecks`：

```json
{
  "acceptanceChecks": [
    {
      "id": "preserve-response-contract",
      "runner": "node",
      "script": "./checks/preserve-response-contract.mjs",
      "args": [],
      "timeoutMs": 900000
    }
  ]
}
```

`script` 相对于根 Contract 所在目录解析，必须位于目标仓库和执行 worktree 之外。Runner 使用固定的 `node` 或 `shell` interpreter 启动脚本，并把 worktree 绝对路径作为第一个参数传入；脚本自己的 fixture 和预期结果也应保存在外部目录。返修 overlay 会继承同一组检查，且 DSH prompt 不包含检查脚本路径或源码。

## 安全模型

- DSH 通过无 shell 的子进程方式启动。
- Harness 的 PATH 优先使用 Runner 生成的 Git policy wrapper；标准 `git commit` / `git push` 会被拒绝并记录。Harness 结束后 Runner 还会比较 HEAD 与 refs，检测绕过 wrapper 的本地历史改写。
- `requiredChecks` 会通过 `/bin/sh -lc` 执行，因此只能运行可信任务契约。
- `acceptanceChecks` 使用无 shell 的固定 interpreter 执行外部脚本；检查仍属于可信代码，不是安全 sandbox。
- 外部 Skill 是会进入执行模型上下文的可信代码；Runner 校验位置、frontmatter、symlink 和内容 hash，但不会证明 Skill 指令本身安全。
- baseline、required 和 acceptance checks 只继承 PATH、HOME、locale、临时目录和包管理器路径等白名单环境变量，不继承 `*_API_KEY`、Token、DSH session 或 SSH agent 等宿主凭据。
- POSIX 命令在独立 process group 中运行；timeout 会终止整个进程组，避免 Harness 或 CLI 的派生进程残留。
- 执行结束后，Runner 会使用 `allowedPaths` 和 `forbiddenPaths` 核验真实变更文件。
- Runner 不会自动 commit、push、merge 或删除 worktree。
- 主仓库不会作为执行代理的写入目录。
- 返修必须使用 repair overlay，禁止复制后手动改写原始验收条件。

路径与 Git policy 属于通道约束及事后检测，不是完整的文件系统或网络 sandbox。执行代理仍可能通过绝对可执行路径或自带网络客户端绕过命令 wrapper；Runner 能检测本地 HEAD/ref 变化，但无法撤销已经发生的外部 remote 写入。如果未来需要执行不可信指令或从 OS 层保证禁止 push，必须叠加容器、网络策略或系统 sandbox。

## 验证策略

不要从依赖 Skill 的界面任务开始。应先使用普通仓库任务建立无 Skill 基线，再对同一个任务进行有 Skill 和无 Skill 的配对实验。

推荐顺序：

1. 带确定性单元测试的纯逻辑缺陷；
2. 带行为保持测试的跨文件重构；
3. 不使用设计 Skill 的前端表单修改；
4. 使用 Ant Design 或项目 Design System Skill 重复同一个前端任务；
5. 诱导执行者修改禁止文件的边界任务；
6. 需求含糊、正确行为应是停止并报告阻塞的任务。

每次记录首次通过率、审阅问题严重度、边界违规、返修次数、耗时和可获取的 Token/API 成本。Skill 应被视为实验变量，而不是无 Skill 基线的一部分。

当前进度见 `ROADMAP.md`；代理职责、安全约束和标准操作流程见 `AGENTS.md`。

## 发布形态

项目计划以 GitHub/npm 上的 DSH Bridge 为核心发布，并主要面向 DSH/Cordis 生态；Codex plugin 作为可选薄 companion，只提供 Skill、命令入口和依赖检查，不复制 transport 或 review UI。完整决策与发布顺序见 `docs/distribution-strategy.md`。

项目尚未公开发布。发布前必须完成 `docs/release-checklist.md` 中的许可证、repository metadata、隐私/evidence 策略和安全审计 gate。贡献规则见 `CONTRIBUTING.md`，安全报告与边界见 `SECURITY.md`，当前 Codex 调用方式见 `docs/codex-companion-installation.md`。
