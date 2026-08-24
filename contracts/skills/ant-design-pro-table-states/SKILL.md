---
name: ant-design-pro-table-states
description: 为现有 Ant Design Pro 的 ProTable 数据页补齐 loading、empty、error、retry 与 recovery 状态，同时保留仓库架构和既有 CRUD 行为。仅适用于已有 ProTable request 数据流的窄范围状态增强，不用于重做页面布局或引入新依赖。
---

# Ant Design Pro Table States

先检查目标页面的 `ProTable`、request function、`actionRef`、现有测试和相邻组件，不重做页面结构。

## 实现约束

- 保留 `ProTable` 自己管理 request Promise 的 loading 行为；不要建立第二份 rows、pagination 或 loading source of truth。
- 用页面内的轻量 error state 表达最近一次加载失败。捕获 request rejection，向用户显示稳定、可访问的 `Alert`，不要直接泄露原始异常内容。
- Retry 必须重新触发现有 `actionRef` 的 reload 路径，而不是刷新浏览器或复制查询逻辑。下一次成功 request 后清除旧 error。
- 使用 Ant Design 的 `Alert`、`Button`、`Empty` 和现有 Token/间距能力；不要增加新的 Card、背景层、CSS 文件或依赖。
- Empty state 必须通过 `ProTable` 的既有扩展点表达，并且与 error state 语义分离。
- 保留 search、pagination、selection、create/update/delete 和 detail Drawer 的既有行为。

## 状态证据

在现有 Vitest/Testing Library 测试中使用 deterministic mock，至少证明：

1. pending request 不会提前完成，仍由 ProTable 呈现 loading；
2. successful empty response 保留成功语义并呈现明确 Empty state；
3. rejected request 不产生 unhandled rejection，并显示 error feedback；
4. Retry 调用现有 reload；
5. Retry 后成功会移除陈旧 error。

只修改 Contract 允许的页面与测试文件。不要运行 dependency install，不要修改 route、service、mock、locale、配置、lockfile 或 Git 状态。
