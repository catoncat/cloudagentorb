# Cursor Cloud 编排初始化包

给任意绑定 GitHub 的 Cursor Cloud 项目，一次粘贴即可装上「**弱主会话编排 + 强云端子代理执行**」工作流。与任何具体产品无关。

## 使用场景

你在 Cursor Cloud 新建了一个绑定 GitHub 仓库的对话，首次运行时它要求你做环境 setup。此时把下面这段提示词贴给它：

```text
请为本仓库初始化 Cursor Cloud 编排工作流（弱主会话编排 + 强云端子代理执行）：

1. git clone --depth 1 https://github.com/catoncat/cloudagentorb /tmp/orch-init
   （若 clone 不可用，改用 raw 地址逐个抓取：https://github.com/catoncat/cloudagentorb 下的 INIT.md 与 template/ 内全部文件。）
2. 严格按照 /tmp/orch-init/INIT.md 执行：把 template/ 下的文件放进本仓库、填好占位符、自检、提交。
3. 完成后向我报告：写入了哪些文件、占位符取了什么值、下一步建议。
```

发布本仓库后，把 `https://github.com/catoncat/cloudagentorb` 换成它的实际 GitHub 地址，这段提示词就是你唯一要保存的东西。

## 这套工作流是什么

| 层 | 内容 | 在哪 |
| --- | --- | --- |
| Cursor 平台能力 | Cloud Task、`cursor-cloud` MCP、`cursor-subscriptions` | 平台自带，不进 git |
| 本初始化包 | 一份编排手册 + 一条 always-on 规则 + 一个 transcript 过滤脚本 + ticket 骨架 | 装进目标仓库的 git |
| 项目自有 | 产品决策、架构文档、具体 ticket 内容 | 目标项目自己写 |

核心分工：Cursor 主会话只当**编排器**（选票、派 Task、审 PR、合并）；所有研究、设计、实现交给云端独立 VM 里的**强模型子代理**。子代理开工前通过 `cursor-cloud` MCP 拉取编排会话 transcript，用过滤脚本读 32K 字符以内的 digest，拿到用户原话而不炸上下文。

## 内容清单

```text
README.md    # 本文件：场景 + 粘贴提示词
INIT.md      # setup agent 的执行指令（唯一入口）
template/    # 会被复制进目标仓库的 5 个文件
  AGENTS.md                                # 编排手册（唯一一份，含派工 Prompt 模板与 bootstrap 块）
  .cursor/rules/orchestrator.mdc           # Cursor always-on 规则：主会话只编排
  scripts/extract-orchestrator-context.ts  # transcript → digest 过滤脚本（零依赖，bun 直跑）
  .scratch/issues/INDEX.md                 # ticket frontier 骨架
  .scratch/issues/TEMPLATE.md              # ticket 模板
```

占位符只有三个，初始化时由 setup agent 和你确认：`<YOUR_STRONG_MODEL>`（你账号下最强的云端模型 slug）、`<YOUR_VERIFY_COMMANDS>`（项目验证命令）、`<MAX_PARALLEL_TASKS>`（并行 Task 数，默认 3）。

## 手动使用（不经 setup agent）

把 `template/` 下 5 个文件按相同路径拷进你的仓库，替换三个占位符，提交即可。首个建议动作：让主会话派一个无害实验 Task，验证 `batch-fetch-details` + 过滤脚本在你账号下可用（见 `template/AGENTS.md` 第 7 节）。
