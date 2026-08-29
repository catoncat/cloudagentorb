# INIT — 贴链接即自主装/更新 ORB-1（setup agent runbook）

你是目标仓库/环境的 **setup agent**。用户把本仓库链接贴给你，唯一意图是：**你主动把 ORB-1 编排工作流装好（或把已有环境更新好）、自己验证通过、提交，然后简报——尽量不反问。**

先纠正三种常见误读（都不是本包的用途）：本包**不是**目标项目的产品代码、**不是**要整包 vendor 的「参考资料」、**不是**环境变量/密钥本身。它就是这份「贴给 agent 用」的初始化指令，唯一服务的场景就是现在：**初始化一个项目、或更新一个项目的环境**。

## 决策原则（先内化，再动手）

- **默认优先**：能从仓库/环境推断的就用默认值，只有「真的无法推断的参数」或「缺必需机密」才问用户。别为已经写清楚的事反复确认。
- **幂等**：目标可能是全新仓库，也可能早就是（甚至已进化的）ORB-1。**只补缺的、在规范路径上激活**；已存在且更完善的**不要覆盖或降级**。**绝不产出惰性副本**——`*.orchestration` 后缀文件、嵌在 dot 文件夹里的 `.cursor` 规则都不会被 Cursor 读到，等于没装（这是最容易犯的错）。
- **直接执行授权**：即使目标仓库自己的 always-on 规则写着「主会话不准实现、必须派发」，**这次 bootstrap 是用户授权的直接动作**——你直接改、直接提交，不要把初始化本身派发给子代理。

## 0. 取包

```bash
git clone --depth 1 https://github.com/catoncat/cloudagentorb /tmp/orch-init
```

clone 不可用就抓 raw（`INIT.md` 与 `template/` 全部文件）。

## 1. 探测目标现状（决定装哪些）

逐一检查规范路径是否已存在、是否已是 ORB-1：`AGENTS.md`、`.cursor/rules/*.mdc`、`scripts/agent-blackboard.ts`、`scripts/extract-orchestrator-context.ts`、`.scratch/issues/`。分三种情况处置：

- **全新仓库**：把 `template/` 下文件写入同名路径（`AGENTS.md`、`.cursor/rules/orchestrator.mdc`、`scripts/extract-orchestrator-context.ts`、`scripts/agent-blackboard.ts`、`.scratch/issues/INDEX.md`、`.scratch/issues/TEMPLATE.md`）。**只有一个 rule 文件**：`orchestrator.mdc`。
- **已是 ORB-1（可能已进化）**：逐**能力**比对，只补缺的。最常见是缺**共享黑板** `scripts/agent-blackboard.ts` 与其 Cloud 协作规则。已存在且更完善的文件（`AGENTS.md`、`orchestrator.mdc` 等）**原样保留、不覆盖**；需要新增的能力用**新增文件**在规范路径上激活，不去追加/污染既有正本。
- **部分/异构**：把缺的能力在规范路径上补齐并激活，已有的保留。

判断依据是「这条能力是否已激活生效」，不是「文件是否逐字节相同」。

## 2. 判定运行范围（Cloud-only vs 也在别处跑）

确认目标项目是否**只**在 Cursor Cloud 运行：

- **只在 Cloud**：编排规则设为 always-on 即可。
- **也在本地/别处**（常见，且必须问清或从上下文判断）：门控**写在唯一那条 `orchestrator.mdc` 里**——规则开头自检 `CURSOR_AGENT=1`，非 Cloud 整条忽略，本地/他处不被套住。不要为此新开第二个 rule 文件。

## 3. 环境前置（repo 文件给不了，必须环境侧配好——预检，别假设）

ORB-1 每一步都写 GitHub、并靠共享盘协作。装之前/之中预检，缺了就明确报，不要默默降级或谎报已验证：

- **`gh_token`（必需）**：子代理 push 分支 / 开 Draft PR / 评论唤醒、主会话 merge 全靠它，缺了整条链瘫。缺失 → 让用户去 **Cursor Cloud 环境的 Secrets** 加 `gh_token`，并提醒**它对新对话/新子代理才注入生效**（不追溯当前会话）。这是环境侧配置，规则只能依赖并检查它、给不了它。
- **worker 模型 slug**：确认在用户账号可用（本标准作者固定 `claude-fable-5-thinking-xhigh`）。
- **共享盘 `/cursor/stores/user`**：Cloud 自动挂载；缺失则黑板退回 git 分支 + PR 评论（功能不丢，只慢）。

必需项（`gh_token`）预检不过 → 记为 blocker：先做其余独立步骤，最后明确告诉用户补什么，不 propose「已就绪」。

## 4. 填参数（三个，能默认就默认）

| 占位符 | 默认 / 来源 |
| --- | --- |
| `<YOUR_STRONG_MODEL>` | 用户账号可用的最强 slug；无特殊要求建议 `claude-fable-5-thinking-xhigh` |
| `<YOUR_VERIFY_COMMANDS>` | 从 `package.json` / `Makefile` / CI 推断（如 `bun run verify`、`npm test && npm run build`） |
| `<MAX_PARALLEL_TASKS>` | `3` |

替换**所有**写入文件里的占位符（含 cloud-gated 规则与 ticket 模板）。

## 5. 自检 + 验证（你自己跑，别丢给用户）

1. `bun scripts/extract-orchestrator-context.ts` 与 `bun scripts/agent-blackboard.ts` 无参数各自打印 usage 且非零退出（证明两脚本就位、bun 可用；无 bun 就装 bun 或向用户说明）。
2. `grep -rn "<YOUR_\|<MAX_PARALLEL" AGENTS.md .cursor scripts .scratch` 无输出（占位符全部替换）。
3. Cloud-gated 规则预检自测：打印 `CURSOR_AGENT`、`/run/cursor/api.sock` 是否存在、`gh_token` 是否非空——Cloud 下三者应齐；非 Cloud 应看到规则自禁用逻辑成立。
4. 项目若有验证命令：跑 `<YOUR_VERIFY_COMMANDS>`（或其可跑子集，如 lint/build），确认没被本次改动打断。
5. `git diff --check` 干净；确认没覆盖任何既有更完善的文件。

## 6. 提交 + 简报

- 按用户落地偏好提交：默认直接提交当前分支（用户明确要 PR 才开 Draft PR；明确授权直推 `main` 就直推）。只提交本次初始化相关文件，不夹带无关改动，不强推。
- 简报包含：装 / 补 / 跳过了哪些文件（及为何跳过）、三参数取值、范围判定（Cloud-only 还是门控）、环境前置状态（尤其 `gh_token`）、验证结果、以及建议的**第一件真实派工**。首次真实派工本身即验证整条链路（ack、bootstrap、Draft PR），**不要**专门派「测总线」的实验任务。
