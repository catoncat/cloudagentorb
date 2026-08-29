# Cursor Cloud 编排初始化包

给任意绑定 GitHub 的 Cursor Cloud 项目，一次粘贴即可装上「**弱主会话编排 + 强云端子代理执行 + 共享黑板**」工作流。与任何具体产品无关。

铁律（一切的前提）：**主会话永远不亲自做工作，只沟通与派发**。所有研究、设计、实现、验证、开 PR 都发生在 Task 工具派出的云端强模型子代理里（`environment: "cloud"`）。

## 一次粘贴接入

新建（或已有）一个绑定 GitHub 仓库的 Cursor Cloud 对话，把下面这段提示词贴给它：

```text
请为本仓库初始化 Cursor Cloud 编排工作流（弱主会话编排 + 强云端子代理执行 + 共享黑板）：

1. git clone --depth 1 https://github.com/catoncat/cloudagentorb /tmp/orch-init
   （若 clone 不可用，改用 raw 地址逐个抓取：https://github.com/catoncat/cloudagentorb 下的 INIT.md 与 template/ 内全部文件。）
2. 严格按照 /tmp/orch-init/INIT.md 执行：把 template/ 下的文件放进本仓库、填好占位符、自检、提交。
3. 完成后向我报告：写入了哪些文件、占位符取了什么值、下一步建议。
```

这段提示词就是你唯一要保存的东西。

## 完整方案

三层能力，各归其位：

| 层 | 内容 | 在哪 |
| --- | --- | --- |
| Cursor 平台能力 | Cloud Task、`cursor-cloud` MCP、`cursor-subscriptions`、每个云端会话自动挂载的同用户共享盘 `/cursor/stores/user/` | 平台自带，不进 git，无需配置 |
| 本初始化包 | 编排手册 + always-on 规则 + transcript 过滤脚本 + 黑板脚本 + ticket 骨架 | 装进目标仓库的 git |
| 项目自有 | 产品决策、架构文档、具体 ticket 内容 | 目标项目自己写 |

四条通信通道，各有分工（细节与实测边界见 `template/AGENTS.md` 第 7–8 节）：

| 通道 | 用途 |
| --- | --- |
| MCP transcript 快照 + 过滤脚本 | 子代理开工时自取编排会话里的用户**原话**，不炸上下文 |
| 共享黑板 `/cursor/stores/user/shared-state/` | 并发任务近实时（10–30s）互报状态；这是**用户全域**共享，不限父子 |
| 进 git 的 ticket 与文档 | 持久正本：work orders 与里程碑裁决 |
| GitHub Draft PR 与评论 | 交付物 + 唤醒已订阅的 IDLE 子代理 + 人类可见审计痕迹 |

关键事实（2026-08-29 实测）：各云端 VM 的 `/workspace` 互不可见；跨会话唯一实时共享面是 `/cursor/stores/user/`（`flock` 可用）；对 RUNNING 中的会话**不存在带外推送**，实时协作靠各方轮询黑板；`Task(resume)` 只对 IDLE 会话有效；`subscribe_github_pr` 只在订阅方结束 turn 后投递；不用 `subscribe_timer`（时钟不是正确的唤醒条件）。

## 完整工作流（端到端）

1. **建项目**：Cursor 里新建 Cloud Agent 对话并绑定 GitHub 仓库。无需额外机密或挂载配置——共享盘与 MCP 都是平台自动的。
2. **装包**：首次对话贴「一次粘贴接入」提示词。setup agent 按 `INIT.md` 复制 `template/` 下 6 个文件、和你确认 3 个占位符、自检、提交。
3. **主会话从此只编排**：`.cursor/rules/orchestrator.mdc` 是 always-on 规则，Cursor 自动应用；主会话只对话、写 ticket、派 Task、读黑板、审 PR、merge。
4. **首次验证**：派一个无害实验 Task（`template/AGENTS.md` 第 9 节），确认 transcript bootstrap 与黑板 round-trip 在你的账号可用。
5. **正常循环**：用户提需求 → 主会话写自包含 ticket → `Task(environment: "cloud", model: "claude-fable-5-thinking-xhigh")`（换成你账号的最强 slug）→ 子代理注册黑板、bootstrap 上下文、实现、验证、push 分支 / Draft PR、黑板收尾 → 主会话读黑板与 PR → review → 按依赖顺序 merge → 下一波。
6. **唤醒 IDLE 子代理（无 timer）**：`Task(resume)`；或评论它订阅过的 Draft PR；或用户 follow-up。对 RUNNING 子代理只能写黑板等它轮询。
7. **换新主会话恢复**：按 `template/AGENTS.md` 第 11 节顺序读文件，不从聊天历史推断状态。

## 配置放哪：Cursor 侧 vs GitHub 侧

| 去向 | 内容 |
| --- | --- |
| Cursor（不进 git，基本零配置） | Cloud Agents 项目绑定仓库；确认强模型 slug 在你账号可用（例：`claude-fable-5-thinking-xhigh`）；Task 参数 `environment` / `model` 由规则与手册固定。`cursor-cloud`、`cursor-subscriptions` MCP 与用户共享盘挂载都是平台自带。 |
| 目标仓库 git（本包安装的全部） | `AGENTS.md`、`.cursor/rules/orchestrator.mdc`、`scripts/extract-orchestrator-context.ts`、`scripts/agent-blackboard.ts`、`.scratch/issues/` 骨架。 |
| GitHub（无必需改动） | 本编排包仓库本身（公开可 clone 即可）。可选惯例：子代理的 Draft PR 兼作唤醒信道（结束 turn 前 `subscribe_github_pr`，之后评论即唤醒）。token 预期：子代理的 GitHub token 能 push 分支与评论，但**不一定**能开 PR——开不了就报 compare URL，由编排器落地 PR。 |

## 内容清单

```text
README.md    # 本文件：铁律 + 方案 + 端到端工作流 + 配置去向
INIT.md      # setup agent 的执行指令（唯一入口）
template/    # 会被复制进目标仓库的 6 个文件
  AGENTS.md                                # 编排手册（角色、黑板协议、唤醒矩阵、派工 Prompt 模板）
  .cursor/rules/orchestrator.mdc           # Cursor always-on 规则：主会话只编排（铁律）
  scripts/extract-orchestrator-context.ts  # transcript → digest 过滤脚本（零依赖，bun 直跑）
  scripts/agent-blackboard.ts              # 共享黑板脚本：roster / tasks / bus + flock（零依赖，bun 直跑）
  .scratch/issues/INDEX.md                 # ticket frontier 骨架
  .scratch/issues/TEMPLATE.md              # ticket 模板
```

占位符只有三个，初始化时由 setup agent 和你确认：`<YOUR_STRONG_MODEL>`（云端子代理模型 slug，无特殊要求时建议 `claude-fable-5-thinking-xhigh`）、`<YOUR_VERIFY_COMMANDS>`（项目验证命令）、`<MAX_PARALLEL_TASKS>`（并行 Task 数，默认 3）。

## 手动使用（不经 setup agent）

把 `template/` 下 6 个文件按相同路径拷进你的仓库，替换三个占位符，提交即可。首个建议动作：让主会话派一个无害实验 Task，验证 `batch-fetch-details` + 过滤脚本 + 黑板在你账号下可用（见 `template/AGENTS.md` 第 9 节）。
