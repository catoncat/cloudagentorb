# Cursor Cloud 编排初始化包

给任意绑定 GitHub 的 Cursor Cloud 项目，一次粘贴装上 **ORB-1 标准**：主会话派发，云端子代理执行；初始化一次粘贴；通信是默认基础设施，不是产品。规范正本见 [`REQUIREMENTS.md`](REQUIREMENTS.md)，与任何具体产品无关。

## 目标（ORB-1 摘要）

- **派发合同**：`Task(environment: "cloud", model: "<每项目固定的强模型 slug>")`，每件事新开子代理。本标准作者账号固定 `claude-fable-5-thinking-xhigh`；其他账号在初始化时选定自己的最强 slug，之后不按任务换。
- **主会话**：权限完整（git / Cursor / gh），但保持薄——长命、模型较弱、上下文要撑很多次派发。不实现、不研究、不预写方案。对同一件事的 follow-up 用 `Task(resume)`，绝不开重复 Task。
- **Prompt**：只有「用户需求（轻度整理）+ 完成所需背景」，没有别的。不写解决方案，不加自创门槛。
- **等待**：hang-listen——`subscribe_github_pr` 后结束 turn、Task 完成通知；不 tight-poll，不用 `subscribe_timer` 当日常唤醒。
- **子代理**：先 ack 再干活；独立分支 + Draft PR。

## 一次粘贴接入

新建（或已有）一个绑定 GitHub 仓库的 Cursor Cloud 对话，把下面这段提示词贴给它：

```text
请为本仓库初始化 Cursor Cloud 编排工作流（ORB-1：主会话派发 + 云端子代理执行 + 共享黑板）：

1. git clone --depth 1 https://github.com/catoncat/cloudagentorb /tmp/orch-init
   （若 clone 不可用，改用 raw 地址逐个抓取：https://github.com/catoncat/cloudagentorb 下的 INIT.md 与 template/ 内全部文件。）
2. 严格按照 /tmp/orch-init/INIT.md 执行：把 template/ 下的文件放进本仓库、填好占位符、自检、提交。
3. 完成后向我报告：写入了哪些文件、占位符取了什么值、下一步建议。
```

这段提示词就是你唯一要保存的东西。装完之后，新的主会话和新的子代理进这个仓库就自动知道本标准（always-on 规则 + AGENTS.md）。

## 方案

三层能力，各归其位：

| 层 | 内容 | 在哪 |
| --- | --- | --- |
| Cursor 平台能力 | Cloud Task、`cursor-cloud` MCP、`cursor-subscriptions`、每个云端会话自动挂载的同用户共享盘 `/cursor/stores/user/` | 平台自带，不进 git，无需配置 |
| 本初始化包 | 编排手册 + always-on 规则 + transcript 过滤脚本 + 黑板脚本 + ticket 骨架 | 装进目标仓库的 git |
| 项目自有 | 产品决策、架构文档、具体需求内容 | 目标项目自己写 |

通信通道都是默认基础设施（细节见 `template/AGENTS.md` 第 5、7、8 节），不占用 prompt、不当作任务派发：

| 通道 | 用途 |
| --- | --- |
| MCP transcript 快照 + 过滤脚本 | 子代理需要时自取编排会话里的用户**原话**，不炸上下文 |
| 共享黑板 `/cursor/stores/user/shared-state/` | 用户全域共享状态：子代理 ack、进度、冲突面（`/workspace` 与 sibling `self` store 均不共享） |
| 进 git 的 ticket 与文档 | 持久正本：需求容器与里程碑裁决 |
| GitHub Draft PR 与评论 | 交付物 + hang-listen 唤醒信道 + 人类可见审计痕迹 |

## 端到端工作流

1. **建项目**：Cursor 里新建 Cloud Agent 对话并绑定 GitHub 仓库。无需额外机密或挂载配置。
2. **装包**：首次对话贴「一次粘贴接入」提示词。setup agent 按 `INIT.md` 复制 `template/` 下 6 个文件、和你确认 3 个占位符、自检、提交。
3. **主会话从此只派发**：`.cursor/rules/orchestrator.mdc` 是 always-on 规则，Cursor 自动应用。
4. **正常循环**：用户提需求 → 主会话把需求轻度整理成两段式 prompt（需求 + 背景）→ `Task(environment: "cloud", model: 固定强模型)` → 子代理先 ack、需要时 bootstrap 原话、实现、验证、push 分支 / Draft PR、黑板收尾 → 主会话收到 Task 完成通知 → review → 按依赖顺序 merge → 下一波。首次真实派工本身就验证了整条链路。
5. **等待与唤醒（无轮询、无定时）**：主会话要跟进某 PR 就先 `subscribe_github_pr` 再结束 turn；对同一件事的 follow-up 用 `Task(resume)` 恢复原 IDLE 子代理，不开重复 Task；RUNNING 会话之间只有共享盘可递话。
6. **换新主会话恢复**：按 `template/AGENTS.md` 第 10 节顺序读文件，不从聊天历史推断状态。

## 配置放哪：Cursor 侧 vs GitHub 侧

| 去向 | 内容 |
| --- | --- |
| Cursor（不进 git，基本零配置） | Cloud Agents 项目绑定仓库；确认强模型 slug 在你账号可用（本标准作者固定 `claude-fable-5-thinking-xhigh`）。`cursor-cloud`、`cursor-subscriptions` MCP 与用户共享盘挂载都是平台自带。 |
| 目标仓库 git（本包安装的全部） | `AGENTS.md`、`.cursor/rules/orchestrator.mdc`、`scripts/extract-orchestrator-context.ts`、`scripts/agent-blackboard.ts`、`.scratch/issues/` 骨架。 |
| GitHub（无必需改动） | 本编排包仓库公开可 clone 即可。子代理的 Draft PR 兼作 hang-listen 唤醒信道（订阅后评论即唤醒）。token 预期：子代理的 GitHub token 能 push 分支与评论，但**不一定**能开 PR——开不了就报 compare URL，由主会话（权限完整）落地 PR。 |

## 内容清单

```text
README.md        # 本文件：ORB-1 目标 + 方案 + 端到端工作流 + 配置去向
REQUIREMENTS.md  # ORB-1 标准原文（规范正本，authority: user）
INIT.md          # setup agent 的执行指令（唯一入口）
template/        # 会被复制进目标仓库的 6 个文件
  AGENTS.md                                # 编排手册（角色、prompt 格式、bootstrap、共享状态、唤醒）
  .cursor/rules/orchestrator.mdc           # Cursor always-on 规则：主会话只派发（ORB-1）
  scripts/extract-orchestrator-context.ts  # transcript → digest 过滤脚本（零依赖，bun 直跑）
  scripts/agent-blackboard.ts              # 共享黑板脚本：roster / tasks / bus + flock（零依赖，bun 直跑）
  .scratch/issues/INDEX.md                 # ticket frontier 骨架（按需使用）
  .scratch/issues/TEMPLATE.md              # ticket 模板（需求容器，不写方案）
```

占位符只有三个，初始化时由 setup agent 和你确认：`<YOUR_STRONG_MODEL>`（云端子代理模型 slug，每项目固定一个；本标准作者为 `claude-fable-5-thinking-xhigh`）、`<YOUR_VERIFY_COMMANDS>`（项目验证命令）、`<MAX_PARALLEL_TASKS>`（并行 Task 数，默认 3）。

## 手动使用（不经 setup agent）

把 `template/` 下 6 个文件按相同路径拷进你的仓库，替换三个占位符，提交即可。之后直接派第一件真实工作——它本身就验证了整条链路。
