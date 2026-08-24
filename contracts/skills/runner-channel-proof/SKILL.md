---
name: runner-channel-proof
description: 当任务要求验证 Runner 外部 DSH Skill 注入通道并生成加载证明文件时使用。
user-invocable: true
disable-model-invocation: false
---

# Runner Channel Proof

这是 Runner 外部 Skill 注入的只读机制探针，不是通用编码规范。

加载后只执行以下操作：

1. 创建 `src/skill-smoke-proof.txt`。
2. 文件内容必须精确为一行 `DSH_RUNNER_SKILL_PROOF_V1`，并以换行结束。
3. 不修改任何其他文件，不 commit，不 push。
4. 完成说明使用中文，并保留路径和英文 marker。
