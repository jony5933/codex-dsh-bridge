# A2 跨文件校验任务评分记录

## 实验信息

| 字段 | 结果 |
| --- | --- |
| 案例 | A2 |
| Base commit | `9b63808f6e5c3dfc53cee01c20898bd73d78d163` |
| 目标仓库 | `<validation-repository>` |
| 实验变量 | 无 Skill；从 A1 单文件逻辑扩展为 Policy、Service、Controller、Test 四文件协作 |
| 最终审阅结果 | `changes-requested` |
| 返修轮数 | 2，已达到自动返修上限 |
| DSH 总执行时间 | 235.058 秒 |
| 路径违规 | 三次运行均为 0 |
| 主工作目录 | 未被 DSH 修改；用户已有 `.DS_Store` 保持未跟踪状态 |

## 第 0 轮：首次实现

- Run ID：`access-request-layers-20260817075134567`
- DSH：退出 0，48.463 秒，未超时。
- 独立检查：`npm test` 退出 0，14/14 通过。
- 修改范围：四个允许文件，无越界。
- Codex review：`changes-requested`。
- P2：disabled 分支在调用 `isWithinDailyWindow` 前返回，使 `startMinute >= endMinute` 的非法请求因 `enabled` 状态不同而得到 200 或 400。
- 最小修复：Policy 无条件校验窗口顺序，并增加 enabled=true/false 配对回归测试。
- Artifacts：`<private-artifact-root>/.artifacts/access-request-layers-20260817075134567`

## 第 1 轮：窗口顺序返修

- Run ID：`access-request-layers-repair-1-20260817075523022`
- DSH：退出 0，70.592 秒，未超时。
- 独立检查：`npm test` 退出 0，24/24 通过。
- 修改范围：四个允许文件，无越界。
- 上轮 P2：已通过 Policy 顺序校验及 enabled=true/false 测试修复。
- Codex review：`changes-requested`。
- P2：Controller 捕获全部原生 `TypeError/RangeError`，会把 getter 或 Service 依赖的意外异常误报为 400。
- 最小修复：使用继承原生错误类型的专用 Validation Error，Controller 只转换 Policy 产生的验证异常。
- Artifacts：`<private-artifact-root>/.artifacts/access-request-layers-repair-1-20260817075523022`

## 第 2 轮：精确错误分类返修

- Run ID：`access-request-layers-repair-2-20260817080243622`
- DSH：退出 0，116.003 秒，未超时。
- 独立检查：`npm test` 退出 0，19/19 通过。
- 修改范围：四个允许文件，无越界。
- 上轮 P2：已通过专用 `AccessRequestTypeError`、`AccessRequestRangeError` 和动态 getter 测试修复。
- Contract 审计：失败。
- 未解决问题 1：`authorizeAccess` 从原始要求的 `{ allowed, reason }` 漂移为 `{ status }`。
- 未解决问题 2：`handleAccessRequest` 从原始要求的 `{ status, body }` 漂移为 `{ status, result/error }`。
- 原因：第 2 轮返修 Contract 没有完整继承第 0 轮的响应结构验收条件，返修测试同步接受了新结构，导致 Runner 误判为通过。
- Artifacts：`<private-artifact-root>/.artifacts/access-request-layers-repair-2-20260817080243622`

## 人工介入

- Codex 编写初始 Contract 和两份返修 Contract。
- 用户批准 Runner 创建隔离 worktree 及 Codex CLI 只读审阅。
- Codex CLI 第二次最终审阅经历网络重连，但最终给出有效 P2 发现。
- 未人工修改任何 DSH 生成的目标代码。

## 结论

A2 证明 Codex review 能连续发现有价值的问题，也证明只依靠返修任务自己的测试会产生验收条件漂移。当前结果不能标记 `approved`，不能合并。下一步必须先让返修流程不可变地继承原始 Contract，再从相同 base commit 启动新的 A2 实验；本轮不进行第 3 次自动返修。
