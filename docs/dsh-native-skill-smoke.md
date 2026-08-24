# DSH rc.7 原生 Skill 加载 smoke

- 验证日期：2026-08-20
- DSH：`@deepseek-ai/dsh@0.1.0-rc.7`
- Profile：`headless`
- 权限：`DSH_PERMISSION_MODE=read-only`
- 目的：确认项目级 `SKILL.md` 是否能被发现、显式注入和按 description 自动加载；本实验不评价 Skill 对编码质量的收益。

## 源码与组合配置事实

- `headless --dump-config` 确认实际挂载 `@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem` 和 `@deepseek-ai/dsh-tool-skill`，无需为基础 Skill 能力安装额外 Plugin。
- 默认项目根由 cwd 最近的 `.git` 祖先确定。
- 项目级根依次为 `<projectRoot>/.dsh/skills` 和 `<projectRoot>/.agents/skills`；用户级根为 `~/.dsh/skills` 和 `~/.agents/skills`。
- 支持 `<root>/<name>/SKILL.md` 和 `<root>/<name>.md`，不递归发现更深的 `**/SKILL.md`；`name` 必须为 kebab-case，`name` 与 `description` 是必填 frontmatter。
- catalog 只向模型提供 name/description 摘要；正文由显式 `/name` 注入或模型调用 `skill` loader 后进入上下文。

## Fixture

项目根：`<temporary-skill-smoke-project>`

Skill：`.dsh/skills/runner-channel-smoke/SKILL.md`

正文包含请求中未提供的固定成功输出：

```json
{"skillLoaded":true,"marker":"DSH_RC7_SKILL_7F3A9C","mode":"native"}
```

独立负对照项目：`<temporary-skill-control-project>`，只包含空 `.git` 目录，不包含 Skill root。

## 结果

### 显式用户调用

请求包含 `/runner-channel-smoke`，不包含 marker。DSH 退出 0，并精确返回 Skill 正文规定的成功 JSON。结论：`user-invocable` 的 `/name` 注入路径有效。

### description 自动调用

新建 headless session，请求只描述“验证 DSH 原生 Skill 加载并给出标准通道加载证明”，不包含 Skill name 或 marker。DSH 退出 0，并精确返回同一成功 JSON。结论：catalog description 路由与模型侧正文加载有效。

### 无 Skill 负对照

在不含 Skill 的独立项目中发送与自动调用完全相同的请求。DSH 退出 0，但报告 `skill("runner-channel-smoke")` 为 unknown，并返回失败说明，没有把成功 JSON 作为最终结果。结论：项目 catalog 按最近项目根隔离，不会把相邻项目的 Skill 注册为当前项目可用项。

负对照模型仍通过只读文件访问找到了相邻 `/private/tmp` fixture，并在说明中引用其 name 和 marker。这证明 `read-only` 不是“只能读取 workspace”的隔离边界，marker 只能作为加载行为探针，不能作为秘密或安全凭据。

## 可观察性限制

- headless stdout 只提供最终回复，不提供独立的 Skill catalog、loader tool call 或 token usage 事件流。
- 本次生成的压缩 `session.jsonl.zstd` 只包含 session header，没有保存模型与工具事件，因此无法从持久 artifact 独立重建 `skill` tool call。
- 自动调用的证据由“全新 session + 请求不含 name/marker + 精确返回正文结果 + 无 Skill 负对照失败”共同构成，强于单次模型声明，但仍不等同于完整 tool-event audit。
- Web Host/ACP 若能提供标准事件流，应在 M7 补充 Skill catalog 和 tool call 的机器可验证记录。

## 对 Runner 的设计结论

正式无 Skill / 有 Skill 配对不应把实验 Skill 写进目标仓库 base commit，否则无 Skill 组也会发现它；也不应在 DSH 启动后临时污染 execution worktree，否则 Skill 文件会进入 diff 和路径边界。

推荐为 Runner 增加可信的外部 Skill 注入配置：

1. Skill bundle 保存在目标仓库与 execution worktree 外。
2. Runner 校验 bundle 路径、`SKILL.md` frontmatter 和预期 Skill name。
3. 仅有 Skill 组为 Harness 设置外部 bundled/custom Skill root；无 Skill 组不设置。
4. 两组保持相同 repository、base commit、目标、acceptance criteria、checks、模型和超时；唯一变量为 Skill availability/invocation。
5. Runner 在 `result.json` 中记录 Skill name、来源路径 hash、启用方式和协议版本，但不把 Skill 文件复制进目标 patch。
6. 正式实验同时记录 catalog/正文带来的 Token 成本，避免把 Skill 的上下文开销误判为纯收益。

## 结论

M5 的前置机制验证通过：DSH rc.7 headless 能原生发现并加载项目级 Skill，显式 `/name` 和 description 自动路由均可用。Runner 外部 Skill 注入与审计字段随后已经实现并通过真实 smoke，详见 `docs/runner-external-skill-smoke.md`；下一步准备固定版本的 Ant Design 配对目标。
