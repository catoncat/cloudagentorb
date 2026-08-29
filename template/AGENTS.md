# AGENTS.md — Cursor Cloud 编排工作流

本仓库采用「**弱主会话编排 + 强云端子代理执行**」：Cursor 主会话只决定做什么、什么顺序合并；所有研究、设计、实现交给云端 Task 里的强模型。所有 Agent 先判断自己的角色，再行动。

占位符（初始化时替换）：`<YOUR_STRONG_MODEL>` 云端子代理模型 slug；`<YOUR_VERIFY_COMMANDS>` 项目验证命令；`<MAX_PARALLEL_TASKS>` 并行 Task 数。

## 1. 运行模型

```text
用户指令
   ↓
主会话（编排器）：维护 ticket，最多派 <MAX_PARALLEL_TASKS> 个 Cloud Task
   ↓                    （每个子代理独立 VM，只见 origin/main）
强子代理 A / B / C：实现、验证，push 独立分支（Draft PR）
   ↓
主会话：按依赖顺序 review → merge → 更新 frontier → 派下一波
```

三层能力，别混：**Cursor 平台**（Task、`cursor-cloud` MCP、`cursor-subscriptions`；不进 git）、**本编排包**（本文件 + 规则 + 脚本 + ticket 骨架；进 git）、**项目自有**（产品决策、架构文档、具体 ticket；按项目写）。

## 2. 两种角色

### 主会话 / 编排器

只做四件事：读 `.scratch/issues/INDEX.md` 选下一票；派发或恢复 Cloud Task；检查分支、Draft PR、验证结果并按依赖顺序合并；把新裁决写进文档。**不写产品代码、不深挖实现、不替强模型预写实现方案。** 用户只是讨论时，只对话，不擅自派工。

### 云端子代理

1. `git fetch origin main`，从最新 `origin/main` 新建独立分支；
2. 读 ticket 的「必读」与相关代码；将 ticket 改 `Status: claimed`，填 Owner / Branch；
3. 只做 ticket 范围内的事，不顺手扩边界；
4. 验证：ticket 指定命令，加上 `<YOUR_VERIFY_COMMANDS>` 中适用者；
5. 在 ticket `## Answer` 记录事实、改动、验证结果、剩余限制；
6. push 分支；能开 PR 就只开 **Draft**，开不了（子代理 token 常为只读）就报告 compare URL，由编排器落地 PR。

禁止：push `main`、自标 ready、自 merge、关闭未合并 PR、假设兄弟分支的改动已存在。

## 3. 工作正本

派单只用本地 Markdown（不用 GitHub Issues——子代理通常无其权限）：

- frontier：`.scratch/issues/INDEX.md`
- ticket：`.scratch/issues/NN-<slug>.md`，模板见 `.scratch/issues/TEMPLATE.md`
- 状态机：`todo → ready → claimed → resolved`；遇阻 `blocked`

ticket 必须自包含：目标、必读、范围、不在范围、验收、验证命令。ticket 不够自包含时先修 ticket，不靠长聊天补丁救场。

## 4. 派工流程（编排器每次照做）

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

不要在 prompt 里长贴用户指令全文——子代理会通过 bootstrap 自取原话。

## 5. Task Prompt 模板（顺序固定）

```text
Repository: <repo>

<可选：项目价值观 / 红线段，逐字粘贴>

## Context bootstrap (run FIRST, before any other work)

Dispatch variables (filled by the orchestrator):
- PARENT_BC_ID: <bc-...>
- TASK_TICKET_PATH: <.scratch/issues/NN-....md>
- SIBLING_BC_IDS: <none | bc-...,bc-...>
- CONTEXT_KEYWORDS: <regex over the parent conversation>

Known facts — do NOT spend turns on MCP tool discovery:
- MCP namespace `cursor-cloud` is ready in this VM; the only tool you need is `batch-fetch-details`.
- Your GitHub token may not create PRs: push your branch and report the compare URL instead.

1. Fetch the parent conversation snapshot (one call):
   tool `batch-fetch-details`, arguments
   {"bcIds": ["<PARENT_BC_ID>"], "includeTranscripts": true, "includeDiffMetadata": true}
   The reply prints a run directory; the transcript is <run-dir>/<PARENT_BC_ID>/transcript.json.
2. NEVER read transcript.json wholesale (can be ~0.5M tokens). Build a digest:
   bun scripts/extract-orchestrator-context.ts <run-dir>/<PARENT_BC_ID> --last-user 8 --match "<CONTEXT_KEYWORDS>"
   Read only the digest (capped at 32K chars). Need more? Run --index to locate a message,
   then --msg N or --msg N-M to fetch exact bodies.
3. Siblings — only if SIBLING_BC_IDS is not none (one extra call):
   {"bcIds": [<SIBLING_BC_IDS>], "includeDiffMetadata": true}
   Read each diff-metadata.json to avoid overlapping their work. Fetch a sibling transcript
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

Deliver: changes, exact validation results, branch / PR URL, unresolved limitations.
```

## 6. 上下文通道（两条，别混）

| 通道 | 性质 | 用途 |
| --- | --- | --- |
| MCP transcript（bootstrap 块） | 易失（VM 内 /tmp）、随取随新 | 子代理运行期自取用户**原话**与最新指令 |
| 进 git 的文档 | 持久、活得比会话久 | 里程碑裁决、跨会话背景、实验结论 |

里程碑级裁决必须落进 git（建议 `docs/decisions/README.md`，首次需要时创建登记表），不能只留在聊天里。预算纪律：digest 上限 32K chars；不整读 transcript；长任务在提交最终结论前可再 fetch 一次父会话，确认用户没有改方向。

## 7. 首次验证（装好本包后做一次）

主会话派一个无害实验 Task：prompt 用第 5 节模板，ticket 内容为「用 bootstrap 流程拉取父会话 transcript，输出 digest 的前 10 行，报告是否成功」。成功即证明 `cursor-cloud` MCP 与过滤脚本在当前账号下可用；失败则记录错误，后续派工使用 fallback（把关键上下文直接写进 ticket）。

## 8. 合并与中断

- 合并前：`git fetch origin main`，重读当前决策文档，核对 ticket `Answer` 与验证结果；CI 绿灯不能替代人审 diff。
- 同一 wave 多个 PR 碰同一文件面：按依赖顺序合并，后合者从新 `main` rebase / merge 并重跑验证。
- 用户改方向时：立即停止 merge → 更新决策文档与受影响 ticket → 要求每个在途 PR 重新声明 `compatible / re-scoped / blocked`；不能证明兼容的保持 blocked，不搞「先合再改」。

## 9. 恢复编排

新主会话没有历史记忆时，按顺序读：本文件 → `.scratch/issues/INDEX.md` → frontier ticket → `git log --oneline -20` 与 open PR。不要从聊天历史重新推断状态。
