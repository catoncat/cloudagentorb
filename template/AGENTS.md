# AGENTS.md — Cursor Cloud 编排工作流（ORB-1）

本仓库执行 ORB-1 标准：**主会话派发，云端子代理执行；初始化一次粘贴；通信是默认基础设施，不是产品。** 所有 Agent 先判断自己的角色，再行动。

占位符（初始化时替换）：`<YOUR_STRONG_MODEL>` 云端子代理模型 slug（每个项目固定一个，不按任务换）；`<YOUR_VERIFY_COMMANDS>` 项目验证命令；`<MAX_PARALLEL_TASKS>` 并行 Task 数。

## 1. 运行模型

```text
用户需求
   ↓
主会话（编排器）：权限完整，但保持薄——长命、模型较弱、上下文要撑很多次派发
   ↓   Task(environment: "cloud", model: "<YOUR_STRONG_MODEL>")，每件事新开子代理
强子代理 A / B / C：研究、实现、验证，push 独立分支（Draft PR）
   ↓   Task 完成通知 / PR 订阅唤醒（hang-listen，不轮询）
主会话：review → 按依赖顺序 merge → 派下一波
```

跨会话共享状态只在 `/cursor/stores/user/`（用户全域）；各云端 VM 的 `/workspace` 与 sibling 的 `self` store 互不可见，不当共享用。

## 2. 主会话（编排器）

主会话拥有完整 git / Cursor / gh 权限。它保持薄不是因为没权限，而是因为它长命、模型较弱、上下文要留给许多次派发。因此：

- **不实现、不研究、不预写方案**：一切实际工作（研究、设计、编码、验证、开 PR）都派发云端子代理执行。
- **每件事新开一个子代理**；对同一件事的 follow-up 用 `Task(resume)` 恢复既有 IDLE 子代理，**绝不为同一件事开重复 Task**。
- 最多 `<MAX_PARALLEL_TASKS>` 个并行；同一 wave 避免两个任务改同一文件面（在途子代理的 `cloudAgentBcId` 来自 Task 回执）。
- review 与 merge 是主会话自己的事：按依赖顺序 merge，把新裁决写进文档。
- 用户只是讨论时，只对话，不擅自派工。

## 3. Task Prompt（两部分，多了就错）

```text
<用户需求，轻度整理，不改写成方案>

Background（只放完成所需）:
- PARENT_BC_ID: <bc-...>（子代理按第 5 节自取父会话原话）
- <ticket 路径 / 相关决策 / 代码区域等，如有>
- SIBLING_BC_IDS: <bc-...,...>（仅当存在冲突面的在途子代理）
```

**禁止**写进 prompt：解决方案、设计、额外简报、编排器自创的权限门槛或阈值——除非用户点名。机制类内容（bootstrap、黑板、验证、PR 纪律）都在本文件，子代理进仓库自动读到，prompt 不重复。

## 4. 云端子代理（worker）

1. **先 ack 再干活**：`bun scripts/agent-blackboard.ts register --role worker --goal "<一句话>" --parent <PARENT_BC_ID>`。
2. `git fetch origin main`，从最新 `origin/main` 新建独立分支。
3. 需要用户原话或最新指令时按第 5 节 bootstrap；有 ticket 就读并认领（`Status: claimed`，填 Owner / Branch）。
4. 只做需求范围内的事，不顺手扩边界；验证用需求指定命令，加 `<YOUR_VERIFY_COMMANDS>` 中适用者。
5. push 分支；能开 PR 就只开 **Draft**，开不了（token 权限不足）就报告 compare URL，由编排器落地 PR。
6. 收尾：`bun scripts/agent-blackboard.ts set status=done branch=<branch> pr=<url>`；若之后可能被唤醒继续，**结束 turn 前**用 `subscribe_github_pr` 订阅自己的 Draft PR。

协作合同（仓库级标准，不是临时门槛）：不 push `main`、不自标 ready、不自 merge、不关闭未合并 PR、不假设兄弟分支的改动已存在、不改写黑板上他人的 `tasks/<bcId>.json`。

## 5. 上下文 bootstrap（子代理自取父会话原话）

需要用户原话、最新指令或裁决出处时执行（不需要就跳过）：

1. 一次调用 MCP `cursor-cloud` 的 `batch-fetch-details`：
   `{"bcIds": ["<PARENT_BC_ID>"], "includeTranscripts": true, "includeDiffMetadata": true}`
   回执给出 run 目录；transcript 在 `<run-dir>/<PARENT_BC_ID>/transcript.json`。
2. **绝不整读 transcript.json**（可达 ~0.5M tokens）。用过滤脚本出 digest（上限 32K chars）：
   `bun scripts/extract-orchestrator-context.ts <run-dir>/<PARENT_BC_ID> --last-user 8 --match "<需求关键词>"`
   需要更多：`--index` 定位消息，`--msg N` 或 `--msg N-M` 取正文。
3. `SIBLING_BC_IDS` 非空时：先看黑板（`bun scripts/agent-blackboard.ts read`），再调一次
   `{"bcIds": [<SIBLING_BC_IDS>], "includeDiffMetadata": true}` 读各 diff-metadata.json，避免撞面；
   只有需求明确依赖某 sibling 的产出才取其 transcript。
4. 权威顺序：digest 里的用户原话 > prompt / ticket 的需求与背景 > assistant 转述。digest 是上下文，需求定义任务，不据 digest 扩范围。
5. fallback：MCP 调用失败重试一次，然后仅凭 prompt / ticket 继续，并在最终报告说明上下文通道不可用。

## 6. 工作正本（ticket，按需）

并行多任务或需要持久正本时用本地 Markdown（不用 GitHub Issues——子代理通常无其权限）：frontier 在 `.scratch/issues/INDEX.md`，ticket 为 `.scratch/issues/NN-<slug>.md`（模板见 `TEMPLATE.md`；状态机 `todo → ready → claimed → resolved`，遇阻 `blocked`）。ticket 是「需求 + 背景」的容器，**不写实现方案**。一次性小任务不必开 ticket，prompt 直接带需求。

里程碑级裁决必须落进 git（建议 `docs/decisions/README.md`，首次需要时创建），不能只留在聊天或黑板里。黑板是易失的运行时状态，ticket 与进 git 的文档才是持久正本。

## 7. 共享状态（默认基础设施，不是产品）

共享边界（已实测）：

| 路径 | 共享性 |
| --- | --- |
| `/workspace` | 每 pod 独立 overlay，**不共享**，且可能跨 turn 回收 |
| `/cursor/stores/user/` | 同一用户**全部**云端会话共享（平台自动挂载）；FUSE，跨会话传播约 10–30s；`flock` 可用 |
| `/cursor/stores/self` | 本会话（bcId）私有；sibling 私有盘不可挂（ENOENT） |
| `/cursor/stores/parent` | 仅 Task 生成的子代理有；子可写父的 `inbox/` |

黑板布局（`/cursor/stores/user/shared-state/`）与写纪律：`roster.json` 多写者，read-modify-write 必须在 `flock` 内；`tasks/<bcId>.json` 只有该任务自己写；`bus/events.jsonl` 只追加。`scripts/agent-blackboard.ts`（零依赖，bun 直跑）封装了以上纪律：`whoami` / `init` / `register` / `set key=value` / `post` / `read` / `wait --match`。若 `/cursor/stores/user` 未挂载（脚本会明确报错），退回 git 分支 + PR 评论协调。

非目标：不派「测总线」的活；不为「怎么说话」烧 token。首次真实派工本身就验证了整条链路（ack、bootstrap、Draft PR），失败按第 5 节 fallback 处理并报告。

## 8. 等待与唤醒（hang-listen，不轮询）

| 情形 | 做法 |
| --- | --- |
| 主会话等子代理完工 | 结束 turn，等 Task 完成通知 |
| 主会话要跟进某个 PR | 先 `subscribe_github_pr` 再结束 turn；PR 活动即唤醒 |
| 唤醒 IDLE 子代理 | `Task(resume)` 首选；或评论它订阅过的 Draft PR；或用户 follow-up |
| 给 RUNNING 会话递话 | 没有带外推送；写黑板（`post`），对方在 turn 内自查（`read` / `wait` 只用于短暂协作窗口） |

不 tight-poll；不用 `subscribe_timer` 当日常唤醒。`subscribe_github_pr` 的投递只发生在订阅方**结束 turn 之后**——先订阅、再让出，是为 hang-listen。

## 9. 合并与中断

- 合并前：`git fetch origin main`，重读当前决策文档，核对交付与验证结果；CI 绿灯不能替代人审 diff。
- 同一 wave 多个 PR 碰同一文件面：按依赖顺序合并，后合者从新 `main` rebase / merge 并重跑验证。
- 用户改方向时：立即停止 merge → 更新决策文档与受影响需求 → 在黑板 `post` 一条 directive 让在途任务尽快看到 → 要求每个在途 PR 重新声明 `compatible / re-scoped / blocked`；不能证明兼容的保持 blocked，不搞「先合再改」。

## 10. 恢复编排

新主会话没有历史记忆时，按顺序读：本文件 → `.scratch/issues/INDEX.md`（如在用）→ `git log --oneline -20` 与 open PR。可再跑 `bun scripts/agent-blackboard.ts read` 与 `cursor-cloud` 的 `list-cloud-agents` 看有无在途任务（IDLE 的直接 `Task(resume)`，不开重复 Task）。不要从聊天历史重新推断状态。
