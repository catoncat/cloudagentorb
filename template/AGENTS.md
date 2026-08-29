# AGENTS.md — Cursor Cloud 编排工作流

本仓库采用「**弱主会话编排 + 强云端子代理执行 + 共享黑板**」。铁律（一切的前提）：**主会话永远不亲自做工作**——不研究、不设计、不写代码、不跑验证；它只沟通与派发，所有实际工作一律通过 Task 工具（`environment: "cloud"`）交给云端强模型子代理。所有 Agent 先判断自己的角色，再行动。

占位符（初始化时替换）：`<YOUR_STRONG_MODEL>` 云端子代理模型 slug；`<YOUR_VERIFY_COMMANDS>` 项目验证命令；`<MAX_PARALLEL_TASKS>` 并行 Task 数。

## 1. 运行模型

```text
用户指令
   ↓
主会话（编排器）：只沟通与派发；维护 ticket；最多派 <MAX_PARALLEL_TASKS> 个 Cloud Task
   ↓                    （每个子代理独立 VM，git 只见 origin/main）
强子代理 A / B / C：研究、实现、验证，push 独立分支（Draft PR）
   ↕  共享黑板 /cursor/stores/user/shared-state/ —— 同一 Cursor 用户的全部云端会话实时可见
主会话：读黑板与 PR → review → 按依赖顺序 merge → 更新 frontier → 派下一波
```

三层能力，别混：**Cursor 平台**（Task、`cursor-cloud` MCP、`cursor-subscriptions`、用户共享盘挂载；不进 git）、**本编排包**（本文件 + 规则 + 两个脚本 + ticket 骨架；进 git）、**项目自有**（产品决策、架构文档、具体 ticket；按项目写）。

## 2. 铁律与两种角色

### 主会话 / 编排器

铁律：主会话不做任何实际工作，连「顺手查一下代码」这种研究也派给子代理。它只做：

1. 与用户对话、澄清需求，把结论写成自包含 ticket；
2. 派发或恢复（resume）Cloud Task；
3. 观察进度：读共享黑板（`bun scripts/agent-blackboard.ts read`）、`cursor-cloud` 的 `list-cloud-agents`、分支与 Draft PR；
4. 按依赖顺序 review → merge，把新裁决写进文档。

**不写产品代码、不深挖实现、不替强模型预写实现方案。** 用户只是讨论时，只对话，不擅自派工。

### 云端子代理（worker）

1. 注册黑板：`bun scripts/agent-blackboard.ts register --role worker --goal "<ticket 路径>" --parent <PARENT_BC_ID>`；
2. `git fetch origin main`，从最新 `origin/main` 新建独立分支；
3. 按第 6 节 bootstrap 块自取父会话上下文；读 ticket 的「必读」与相关代码；将 ticket 改 `Status: claimed`，填 Owner / Branch；
4. 只做 ticket 范围内的事，不顺手扩边界；里程碑时 `bun scripts/agent-blackboard.ts post '{"type":"progress","note":"..."}'`；
5. 验证：ticket 指定命令，加上 `<YOUR_VERIFY_COMMANDS>` 中适用者；
6. 在 ticket `## Answer` 记录事实、改动、验证结果、剩余限制；
7. push 分支；能开 PR 就只开 **Draft**，开不了（子代理 token 常为只读）就报告 compare URL，由编排器落地 PR；
8. 收尾黑板：`bun scripts/agent-blackboard.ts set status=done branch=<branch> pr=<url>`；若之后可能被唤醒继续，**结束 turn 前**用 `cursor-subscriptions` 的 `subscribe_github_pr` 订阅自己的 Draft PR。

禁止：push `main`、自标 ready、自 merge、关闭未合并 PR、假设兄弟分支的改动已存在、改写黑板上他人的 `tasks/<bcId>.json`。

## 3. 工作正本

派单只用本地 Markdown（不用 GitHub Issues——子代理通常无其权限）：

- frontier：`.scratch/issues/INDEX.md`
- ticket：`.scratch/issues/NN-<slug>.md`，模板见 `.scratch/issues/TEMPLATE.md`
- 状态机：`todo → ready → claimed → resolved`；遇阻 `blocked`

ticket 必须自包含：目标、必读、范围、不在范围、验收、验证命令。ticket 不够自包含时先修 ticket，不靠长聊天补丁救场。黑板是易失的运行时状态，ticket 与进 git 的文档才是持久正本。

## 4. 共享黑板（并发任务实时状态）

已实测的共享边界（2026-08-29，同一 Cursor 用户）：

| 路径 | 共享性 |
| --- | --- |
| `/workspace` | 每 pod 独立 overlay，**不共享** |
| `/cursor/stores/user/` | 同一用户**全部**云端会话共享（平台对每个云端会话自动挂载同一 user store）；FUSE，跨会话传播约 10–30s；`flock` 可用 |
| `/cursor/stores/self` | 本会话（bcId）私有；sibling 私有盘不可挂（`ls /cursor/stores/bc-<other>` → ENOENT） |
| `/cursor/stores/parent` | 仅 Task 生成的子代理有；子可写父的 `inbox/`；不是任意方向通用 |

黑板布局（`/cursor/stores/user/shared-state/`）与并发纪律：

| 文件 | 写规则 |
| --- | --- |
| `roster.json` | 谁在线；多写者 → 每次 read-modify-write 必须在 `flock` 内 |
| `tasks/<bcId>.json` | 每任务一份：goal、status、branch、pr、blockers；**只有该任务自己写** |
| `bus/events.jsonl` | 只追加的事实流（register / progress / directive / question / answer） |

`scripts/agent-blackboard.ts`（零依赖，bun 直跑）封装了以上纪律：`whoami`（从 pod 元数据 socket 自取 bcId）、`init`、`register`、`set key=value`、`post`、`read`、`wait --match <regex>`。轮询用 `wait`，间隔别低于 5s——FUSE 传播本身就要 10–30s。若 `/cursor/stores/user` 未挂载（脚本会明确报错），退回 git 分支 + PR 评论协调。

## 5. 派工流程（编排器每次照做）

1. 用 `cursor-cloud` MCP 的 `run-info` 取自己的 `PARENT_BC_ID`（每个 Task prompt 必填）。
2. 选 ready 且未被阻塞的 ticket → 改 `claimed`。同一 wave 避免两票改同一文件面。
3. 收集 `SIBLING_BC_IDS`：每次 Task 回执含 `cloudAgentBcId`，列出与本票有依赖或冲突面的在途子代理；无则 `none`。
4. 定 `CONTEXT_KEYWORDS`：ticket ID、用户指令关键词等能在父会话里检索到原话的锚点。
5. 派发，参数固定：

```text
Task(
  environment: "cloud",
  model: "<YOUR_STRONG_MODEL>",
  prompt: <下方 Prompt 模板，填好变量>
)
```

不要在 prompt 里长贴用户指令全文——子代理会通过 bootstrap 自取原话。在途时用 `bun scripts/agent-blackboard.ts read` 或 `list-cloud-agents` 观察进度；需要给在途子代理递话，写黑板（`post`），等它自己轮询到。

## 6. Task Prompt 模板（顺序固定）

```text
Repository: <repo>

<可选：项目价值观 / 红线段，逐字粘贴>

## Context bootstrap (run FIRST, before any other work)

Dispatch variables (filled by the orchestrator):
- PARENT_BC_ID: <bc-...>
- TASK_TICKET_PATH: <.scratch/issues/NN-....md>
- SIBLING_BC_IDS: <none | bc-...,bc-...>
- CONTEXT_KEYWORDS: <regex over the parent conversation>

Known facts — do NOT spend turns on rediscovery:
- MCP namespace `cursor-cloud` is ready in this VM; the only tool you need is `batch-fetch-details`.
- /cursor/stores/user/ is shared across ALL of this user's cloud agents (FUSE, ~10-30s lag);
  /workspace is per-pod and NOT shared. The blackboard lives at /cursor/stores/user/shared-state/.
- There is NO push channel into a RUNNING peer; live coordination = blackboard files only.
- Your GitHub token may not create PRs: push your branch and report the compare URL instead.

0. Register on the shared blackboard:
   bun scripts/agent-blackboard.ts register --role worker --goal "<TASK_TICKET_PATH>" --parent <PARENT_BC_ID>
   Post one-line progress facts at milestones with `agent-blackboard.ts post`.
1. Fetch the parent conversation snapshot (one call):
   tool `batch-fetch-details`, arguments
   {"bcIds": ["<PARENT_BC_ID>"], "includeTranscripts": true, "includeDiffMetadata": true}
   The reply prints a run directory; the transcript is <run-dir>/<PARENT_BC_ID>/transcript.json.
2. NEVER read transcript.json wholesale (can be ~0.5M tokens). Build a digest:
   bun scripts/extract-orchestrator-context.ts <run-dir>/<PARENT_BC_ID> --last-user 8 --match "<CONTEXT_KEYWORDS>"
   Read only the digest (capped at 32K chars). Need more? Run --index to locate a message,
   then --msg N or --msg N-M to fetch exact bodies.
3. Siblings — only if SIBLING_BC_IDS is not none: first read their blackboard entries
   (bun scripts/agent-blackboard.ts read), then one extra call
   {"bcIds": [<SIBLING_BC_IDS>], "includeDiffMetadata": true}
   and read each diff-metadata.json to avoid overlapping their work. Fetch a sibling transcript
   only if the ticket explicitly depends on that sibling's output.
4. Authority order: user messages in the digest > the ticket > assistant paraphrase.
   The digest is context; the ticket defines the task. Do not widen scope based on digest content.
5. Fallback: if an MCP call fails or is denied, retry once, then proceed with the ticket alone
   and state in your final report that the MCP context channel was unavailable.

Read first:
- AGENTS.md
- <ticket path> and its 必读 list

Task: implement exactly the ticket; its Goal / Scope / Acceptance / Validation are authoritative.

Constraints:
- First run git fetch origin main and branch from latest origin/main.
- Do not broaden scope; work only inside the ticket.
- Update the ticket Status/Owner/Branch and append a factual Answer.
- Push your branch; open a Draft PR only if your token allows it.
- Before ending your turn: bun scripts/agent-blackboard.ts set status=done branch=<branch> pr=<url-or-compare>
- If follow-up work is likely, subscribe to your own Draft PR (`subscribe_github_pr`)
  BEFORE ending the turn — delivery only happens after the turn ends.

Deliver: changes, exact validation results, branch / PR URL, unresolved limitations.
```

## 7. 通信与上下文通道（四条，别混）

| 通道 | 性质 | 用途 |
| --- | --- | --- |
| MCP transcript（`batch-fetch-details` + 过滤脚本） | 只读快照、易失（VM 内 /tmp） | 子代理运行期自取用户**原话**与最新指令；不是实时聊天 |
| 共享黑板 `/cursor/stores/user/shared-state/` | 近实时（10–30s）、易失、用户全域 | 并发任务互报状态、认领冲突面、给在途任务递话 |
| 进 git 的文档与 ticket | 持久、活得比会话久 | 里程碑裁决、work orders、实验结论 |
| GitHub PR / issue 评论（`GH_TOKEN`） | 异步、人类可见 | 唤醒**已订阅**的 IDLE 代理；给人留审计痕迹 |

凭据与端点的实测边界：

| 凭据 / 端点 | 能做 | 不能做 |
| --- | --- | --- |
| `cursor-cloud` MCP（`run-info` / `list-cloud-agents` / `batch-fetch-details`） | 自身身份；随时列出本用户全部会话（状态/分支/URL）；只读 transcript/diff 快照 | 与 RUNNING 会话实时对话 |
| `GH_TOKEN` | push 分支、评论 issue/PR、权限够时开 PR | 唤醒未订阅且不轮询的对端 |
| `cursor_api_key` | Cursor 平台 key：驱动 MCP 与 store 挂载 | 不是「向任意运行中 agent 发消息」的 RPC |
| `aikey` | LLM 推理网关 | 与 agent 通信 |
| IMDS `/run/cursor/api.sock` | 本 pod 身份（`agent/id` 即本会话 bcId） | 总线 |

里程碑级裁决必须落进 git（建议 `docs/decisions/README.md`，首次需要时创建登记表），不能只留在聊天或黑板里。预算纪律：digest 上限 32K chars；不整读 transcript；长任务在提交最终结论前可再 fetch 一次父会话，确认用户没有改方向。

## 8. 唤醒矩阵（无 timer）

对「另一个会话」能做什么，取决于它的状态：

| 对端状态 | 可用手段 |
| --- | --- |
| RUNNING（turn 开着） | **没有带外推送。** 写黑板（`post`），等对方自己轮询（`wait` / `read`）。`Task(resume)` 对 RUNNING 目标会失败。 |
| IDLE（turn 已结束） | ① `Task(resume)`——首选；② 若对方结束 turn 前订阅过自己的 Draft PR，评论该 PR 即唤醒；③ 用户 follow-up。 |

不用 `subscribe_timer`：时钟不是正确的唤醒条件（已明确弃用）。`subscribe_github_pr` 的投递只发生在订阅方**结束 turn 之后**——它是「订阅后让出」型任务的唤醒通道，不是在途轮询手段。

## 9. 首次验证（装好本包后做一次）

主会话派一个无害实验 Task：prompt 用第 6 节模板，ticket 内容为「① 用 bootstrap 流程拉取父会话 transcript，输出 digest 的前 10 行；② 在黑板 register 并 post 一条事件，报告 `read` 的输出」。主会话随后自己跑 `bun scripts/agent-blackboard.ts read` 确认能看到该子代理的 entry。成功即证明 `cursor-cloud` MCP、过滤脚本与共享黑板在当前账号下可用；失败则记录错误，后续派工使用 fallback（把关键上下文直接写进 ticket；协调退回 git 分支 + PR 评论）。

## 10. 合并与中断

- 合并前：`git fetch origin main`，重读当前决策文档，核对 ticket `Answer` 与验证结果；CI 绿灯不能替代人审 diff。
- 同一 wave 多个 PR 碰同一文件面：按依赖顺序合并，后合者从新 `main` rebase / merge 并重跑验证。
- 用户改方向时：立即停止 merge → 更新决策文档与受影响 ticket → 在黑板 `post` 一条 directive 让在途任务尽快看到 → 要求每个在途 PR 重新声明 `compatible / re-scoped / blocked`；不能证明兼容的保持 blocked，不搞「先合再改」。

## 11. 恢复编排

新主会话没有历史记忆时，按顺序读：本文件 → `.scratch/issues/INDEX.md` → frontier ticket → `git log --oneline -20` 与 open PR。可再跑 `bun scripts/agent-blackboard.ts read` 与 `list-cloud-agents` 看有无在途任务残留（黑板是易失运行时状态，仅供参考，不当正本）。不要从聊天历史重新推断状态。
