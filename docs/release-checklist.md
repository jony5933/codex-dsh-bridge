# GitHub/npm beta 发布清单

更新日期：2026-08-24

本清单记录 M8 npm beta 首发状态；GitHub tag/Release 仍属于 beta 观察期后的独立决策。

## 当前 release gates

- [x] 许可证选择 MIT，copyright holder 为 `jony5933`；`LICENSE` 与 `package.json#license` 已添加。
- [x] 公开 repository 指定为 `https://github.com/jony5933/codex-dsh-bridge`。
- [x] `package.json#repository`、`homepage`、`bugs` 已补充。
- [x] 原始 evidence 与本机 Contract 采用私有归档策略；公开仓库只保留 `docs/validation-evidence-summary.md`。
- [x] 原始文件已移动到 ignored `.private-release-archive/2026-08-24/`，没有改写不可变 evidence。
- [x] Public GitHub repository 已创建，并从脱敏 snapshot 推送全新 `main` 历史。
- [x] 发布前确认 npm package name `codex-dsh-bridge` 可用，并由 `jony5933` 完成首发。

## 内容与安全审计

- [x] npm tarball 使用 `package.json#files` allowlist。
- [x] tarball 不包含测试、源码、本地 Contract 或真实 evidence。
- [x] tracked 文件未发现 private-key header。
- [x] 未跟踪 `.env` 文件。
- [x] `SECURITY.md` 说明私密报告渠道和真实安全边界。
- [x] `CONTRIBUTING.md` 说明开发、测试与 PR 规则。
- [x] `pnpm run release:audit` 对公开候选树执行 symlink、本机路径、原始 evidence tree、`.env`、private-key header 与常见 Token pattern 检查。
- [x] `pnpm run release:snapshot -- <new-target-directory>` 只复制脱敏候选文件，并拒绝仓库内目标与覆盖已有目录。
- [x] 原始 prompt、JSONL、patch 与 model output 已移出公开候选树；公开目录只保留脱敏 summary。
- [ ] 使用独立 secret scanner 复核完整 Git history；简单文本扫描不能替代 history scan。
- [x] 确认发布 commit 没有不应公开的删除、临时文件或用户未确认的工作。

## GitHub repository

- [x] 默认分支为 `main`。
- [ ] branch protection 策略由维护者在真实协作开始前决定。
- [x] GitHub Private Vulnerability Reporting 已启用。
- [x] Repository description 已设置。
- [x] 已添加 `dsh-plugin`、`deepseek-harness`、`codex`、`web-host` topics。
- [x] 固定公开工作区 `<public-workspace>` 已建立，不再依赖临时 snapshot 目录。
- [x] GitHub Actions CI 已启用；Node `22.19.0` 与 `24.19.0` 均通过 checks、release audit 与 npm tarball dry-run。
- [x] README 明确当前实现是外部 Bridge CLI，不是已由 `dsh plugin add` 管理的 Cordis plugin。
- [ ] Issues/Discussions 是否启用由维护者决定；至少提供 bug report 所需 version、channel 与脱敏 evidence 字段。

## 发布前验证

```bash
pnpm run check
npm pack --dry-run --json
```

- [x] 当前完整自动验证为 94/94 tests。
- [x] `codex-dsh --help` 与 `codex-dsh --version` 通过。
- [x] 隔离 tarball 安装后，`codex-dsh` 与 `deepseek-loop` binary 均可运行。
- [x] 安装包内 review schema 与 executor prompt 可定位。
- [x] release candidate 已重新运行 DSH rc.2 只读 compatibility probe：六项通过，未创建 Workspace/session、未发送 prompt。
- [x] 已用全新临时目录重复 tarball 安装 smoke；两个 binary、help/version、空索引、Schema 与 Prompt 资源定位通过。
- [x] 最终公开 snapshot 已通过 Diff、94/94 tests、release audit 与 tarball dry-run。
- [x] 已从 `release:snapshot` 建立全新 Git history；没有推送当前开发仓库的旧 history。
- [x] 最终 GitHub Actions run `32700955691` 在 Node `22.19.0` 与 `24.19.0` 上全部通过，并覆盖 npm bin 回归测试。

## npm beta

- [x] 登录正确的 npm account `jony5933`，并启用 publish 2FA。
- [x] 复核 package name、version、files、bin、engines、license 与 repository metadata。
- [x] 使用 `beta` dist-tag 发布；npm Public Registry 首发自动创建 `latest`，且拒绝移除唯一版本的该 tag，文档明确其不代表稳定版。
- [x] 获得维护者发布授权后执行：

```bash
npm publish --tag beta
```

- [x] 从 registry 全新安装 `codex-dsh-bridge@beta` 并重复 version、help 与只读 `web-runs` smoke。
- [x] registry integrity 与本地最终 tarball 一致；62 个文件、README、两个 bin、Schema 与 Prompt 均符合 allowlist。

## GitHub beta

- [ ] 由维护者确认 tag/version 命名。
- [ ] 生成 release notes：定位、支持的 DSH versions、安装、已知边界、升级/卸载。
- [ ] 只有在 npm 与 GitHub 内容一致后才发布 GitHub beta。
- [ ] 发布后记录 tag、commit、npm integrity 与 compatibility evidence。

## 发布后

- [x] 验证 README 的 `codex-dsh-bridge@beta` 安装命令。
- [ ] 收集 DSH version incompatibility，不自动放宽支持集合。
- [ ] beta 稳定后发布 stable version，并让 `latest` 获得稳定语义。
- [ ] 根据真实用户需求决定 Cordis adapter；不要为了插件名称复制 core。
- [ ] 再评估 Codex companion scaffold；它只包含 Skill、CLI 入口和依赖检查。
