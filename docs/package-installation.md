# npm 安装与包边界

更新日期：2026-08-24

## 结论

M8 beta 保持单一 npm package，不提前拆分 core、CLI 或 Cordis adapter：

- package：`codex-dsh-bridge`
- 当前版本：`0.1.0-beta.1`
- 主要 binary：`codex-dsh`
- 兼容 binary alias：`deepseek-loop`
- Node.js：`>=22.19`
- DSH：由用户独立安装和管理，不属于 dependency 或 peer dependency

当前 CLI、Web Host adapter、evidence 与 guarded Runner 共享类型和内部模块。此时拆成 monorepo 会增加版本同步与安装复杂度，但没有形成可独立消费的稳定 API。只有 Cordis host package 或其他调用方真正需要独立 core API 时再拆包。

## 前置条件

1. 安装符合 `engines` 的 Node.js。
2. 单独安装 Bridge 已验证支持的 `dsh` 版本。
3. 需要 `web-run` 时，在本机启动 `dsh web`；默认 endpoint 为 `http://127.0.0.1:3080`。
4. DSH credentials 继续由 DSH 自己管理，Bridge 不复制 API Key。

Bridge 每次执行 `web-run` 都会先运行只读 compatibility probe。未知或不兼容的 DSH version/Host capability 会在创建 session 和发送 prompt 前 fail closed。

## npm 安装、更新与卸载

项目尚未发布到 npm。以下命令从首次 GitHub beta/npm beta 发布后开始适用。

全局安装 beta：

```bash
npm install --global codex-dsh-bridge@beta
codex-dsh --version
codex-dsh web-probe "/absolute/path/to/project"
```

项目内安装：

```bash
npm install --save-dev codex-dsh-bridge@beta
npx codex-dsh --version
```

更新到当前 beta channel：

```bash
npm install --global codex-dsh-bridge@beta
codex-dsh web-probe "/absolute/path/to/project"
```

卸载：

```bash
npm uninstall --global codex-dsh-bridge
```

卸载 package 不会卸载 DSH，也不会删除 `~/.dsh-bridge/runs`。该目录包含用户的 evidence 和不可变运行索引，只能由用户在确认保留策略后单独处理。

beta 首发使用 `beta` dist-tag：

```bash
npm publish --tag beta
```

这是 release checklist 中的待执行命令，不得在未获得维护者明确授权时运行。beta 稳定前不占用 `latest`。

## 从源码运行

```bash
nvm use
pnpm install
pnpm run check
pnpm dev -- web-probe "/absolute/path/to/project"
```

源码命令使用 `pnpm dev --`；已安装 package 使用 `codex-dsh`。不要把外部 CLI 描述成已经由 `dsh plugin add` 管理的 Cordis plugin。

## 发布包内容

`package.json#files` 使用 allowlist，只包含：

- `dist/src/**/*.js` 与 `dist/src/**/*.d.ts`
- `contracts/*.schema.json`
- `prompts/*.md`
- `README.md`
- npm 自动包含的 `LICENSE`
- npm 自动包含的 `package.json`

测试、真实运行 evidence、本地 Contract、源码与开发配置不进入 tarball。`prepack` 固定执行 `pnpm run check`。binary 必须指向实际构建路径 `dist/src/cli.js`，不能回退到不存在的 `dist/cli.js`。

## 2026-08-24 本地验证证据

- 当前 release-candidate `npm pack --dry-run --json` 通过：tarball 48,197 bytes，解包 198,449 bytes，共 62 个文件；MIT `LICENSE` 已包含。
- 真实 tarball 安装到隔离目录后，`codex-dsh --version` 与 `deepseek-loop --version` 均输出 `0.1.0-beta.1`。
- 已安装 CLI 的空索引 `web-runs` 查询成功并返回 `count: 0`。
- 已安装代码能定位 package 内 `contracts/review.schema.json` 与 `prompts/executor.md`。
- 完整自动验证为 93/93 tests。
- npm registry 查询 `codex-dsh-bridge` 当时返回 `E404`。这只代表查询时未发现同名 package，不能代替名称预留；正式发布前必须再次检查。

本次验证没有执行 npm publish、全局安装或修改用户的 DSH 安装。

## 后续拆包门槛

满足以下任一条件后，才重新评估 core/CLI/Cordis adapter 拆分：

- DSH 提供稳定 plugin loader/API，需要独立的 host-side lifecycle；
- CLI 之外出现至少一个需要版本化公共 API 的真实消费者；
- Cordis adapter 与外部 CLI 的依赖或权限边界已经不同；
- 单包导致无法独立发布安全修复或兼容 adapter。

Codex companion 仍应保持薄层，只提供 Skill、命令入口和依赖检查，不复制 Bridge core。
