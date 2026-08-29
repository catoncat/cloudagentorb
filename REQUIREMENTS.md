# ORB-1: Cloud Orchestration Standard

| Field | Value |
| --- | --- |
| Number | ORB-1 |
| Title | Cloud Orchestration Standard |
| Status | Active |
| Authority | User (Cursor account owner); goals fixed by the user on 2026-08-29 |
| Editor | Strong-model cloud worker `bc-97d9819f-2e19-5ed1-8081-bf4ed8690666` |
| Supersedes | User sketch of 2026-08-29 (preserved in Git history of this file) |
| Repository | <https://github.com/catoncat/cloudagentorb> |

## Abstract

One long-lived main conversation dispatches; disposable cloud children execute. Installation is one paste. Communication is infrastructure, never the deliverable. This document specifies the two roles, the dispatch contract, the prompt format, the wake discipline, the shared-state layout, and what conformance means, so that any conversation in any repository can follow the standard from the installed files alone.

## Conventions and terms

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.

- **Main** — the long-lived conversation the user talks to. Runs a weaker model by design and survives many jobs.
- **Child** (worker) — a cloud conversation created by the `Task` tool (`environment: "cloud"`), living in its own VM, existing to complete one job.
- **Job** — one unit of user-requested work with an observable outcome (typically a branch and a Draft PR).
- **Dispatch** — main creating or resuming a child via `Task`.
- **Ack** — the child's first observable write announcing it is alive and owns a job.
- **Hang-listen** — subscribing to an external event source and then ending the turn, so the platform delivers the wake; the opposite of staying in-turn to poll.
- **Shared store** — `/cursor/stores/user/`, the platform-mounted volume every cloud conversation of the same Cursor user can read and write.
- **Blackboard** — the agreed layout under `/cursor/stores/user/shared-state/` (§6).

## 1. Roles

### 1.1 Main

- **M1.** Main has full rights — git, `gh`, Cursor tools, merges. Nothing in this standard removes a capability from main.
- **M2.** Main MUST NOT implement, research, or pre-solve a job. Every job is executed by a child (§2). This is the iron law of the standard.
- **M3.** Main's own duties are: converse with the user, dispatch, watch progress, review, merge in dependency order, and record decisions in git.
- **M4.** When the user is only discussing, main MUST only converse. Dispatching requires an actual request for work.

### 1.2 Child

- **W1.** A child MUST ack before substantive work (§5 C3 defines the ack).
- **W2.** A child MUST branch from the latest `origin/main`, work on its own branch, and deliver a Draft PR — or, when its token cannot create PRs, push the branch and report the compare URL for main to open the PR.
- **W3.** Within its job, a child may use every capability its VM grants. Restricting child rights beyond the collaboration contract (§5) requires an explicit user request.

## 2. Dispatch

- **D1.** Dispatch is exactly `Task(environment: "cloud", model: <the project's worker slug>)`. Each project fixes **one** worker slug at init time and does not vary it per job. On the standard author's account the slug is `claude-fable-5-thinking-xhigh`.
- **D2.** Each new job gets a **new** child.
- **D3.** A follow-up on an existing job MUST resume that job's IDLE child (`Task` resume). Main MUST NOT spawn a competing child for a job that already has one.
- **D4.** At most `<MAX_PARALLEL_TASKS>` children run in parallel, and one wave SHOULD NOT contain two jobs editing the same files.

## 3. Prompt

- **P1.** A dispatch prompt has exactly two parts: (a) the user's need, lightly copy-edited — not rewritten into a plan; (b) the background required to finish, including `PARENT_BC_ID` and, when conflict surfaces exist, sibling conversation ids.
- **P2.** A prompt MUST NOT contain solutions, designs, extra briefing, permission gates, or thresholds — unless the user named them.
- **P3.** Standing mechanics (context bootstrap, blackboard, verification commands, PR discipline) live in the installed `AGENTS.md`, which every child reads automatically in-repo. The prompt never repeats them.

## 4. Waiting and wake

- **K1.** No tight polling. `subscribe_timer` MUST NOT be used as an everyday wake; the clock is not the event being waited on.
- **K2.** Main waiting for a dispatched child ends its turn; the `Task` completion notification is the wake.
- **K3.** Main following a PR subscribes with `subscribe_github_pr`, then ends its turn (hang-listen). Subscription delivery only occurs after the subscriber's turn ends.
- **K4.** Waking an IDLE child: `Task` resume is preferred; commenting on a PR the child subscribed to also wakes it; a user follow-up always works.
- **K5.** There is no out-of-band push into a RUNNING conversation. Messages for a RUNNING peer are written to the blackboard and read on the peer's own schedule. In-turn `wait`/`read` on the blackboard MAY serve a short co-work window, never everyday waiting.
- **K6.** A child that expects follow-up work SHOULD subscribe to its own Draft PR before ending its turn.

### 4.1 Time

- **T1.** Every blackboard and bus write carries a UTC timestamp (`scripts/agent-blackboard.ts` adds it). Messages between agents SHOULD state a UTC timestamp when time matters.
- **T2.** Agents MUST judge messages and state by age, not by adjacency. Transcript adjacency is not time adjacency: a wake can arrive minutes or hours after the event, and a resumed conversation may have been idle for a long time. On wake, check timestamps before acting; re-verify facts that age (branch tips, PR state, peer status).
- **T3.** Latency budgets: shared-store propagation is ~10–30 s; `subscribe_github_pr` delivery MAY lag by minutes (≈10 min observed once, possibly mis-observed — budget for it anyway). A channel that is quiet within its budget is not dead. Before declaring a peer stalled or a channel dead, compare the newest relevant timestamp against these budgets.

## 5. Collaboration contract

These are standing repository rules, installed once — not per-job gates (see P2).

- **C1.** Children MUST NOT push `main`, self-merge, mark their own PRs ready, or close unmerged PRs.
- **C2.** Blackboard writes follow single-writer discipline: `tasks/<bcId>.json` is written only by its own conversation; `roster.json` read-modify-writes happen under `flock`; `bus/events.jsonl` is append-only.
- **C3.** The ack (W1) is a blackboard registration: roster entry, own task file, and a register event — then work begins.
- **C4.** Milestone decisions land in git. The blackboard is volatile runtime state and is never the system of record.

## 6. Shared state

- **S1.** The only live cross-conversation share is `/cursor/stores/user/` — mounted user-wide by the platform into every cloud conversation. It is FUSE-backed: cross-conversation propagation is roughly 10–30 seconds, and `flock` is honored.
- **S2.** `/workspace` is a per-pod overlay and MAY be recycled between turns; per-conversation `self` stores are private and sibling stores are unmountable. Neither MUST ever be treated as shared.
- **S3.** Blackboard layout under `/cursor/stores/user/shared-state/`: `roster.json` (who is alive), `tasks/<bcId>.json` (one file per job: goal, status, branch, PR), `bus/events.jsonl` (append-only facts). `scripts/agent-blackboard.ts` implements the discipline.
- **S4.** When the shared store is absent, coordination degrades to git branches plus PR comments. A missing mount never blocks a job.

## 7. Init

- **I1.** One pasted prompt installs this standard into any new conversation and any repository; `INIT.md` in this package is the sole entry point.
- **I2.** Init fixes exactly three parameters: the worker model slug, the project verify commands, and the parallel-task cap.
- **I3.** After init, new mains and new children learn the standard entirely from the installed files (`AGENTS.md`, `.cursor/rules/orchestrator.mdc`); no oral tradition, no re-briefing.
- **I4.** The first real dispatch doubles as the conformance check — ack, context bootstrap, and Draft PR all get exercised. No demo jobs are dispatched to "test the pipes".

## 8. Non-goals

The standard deliberately excludes: bus demos as jobs; token spend on how-to-talk; duplicate children for one job; restricting child rights without a user request; multi-model worker fleets; and any communication feature beyond what §4–§6 already provide.

## Rationale

- *Thin main (M2)* — main is not weak in rights but in economics: it runs a cheaper model and must survive many jobs, so its context belongs to dispatching and deciding, never to doing. The moment main implements, it competes with its own children using a worse model and a scarcer context.
- *One slug (D1)* — per-job model shopping burns main's turns on a decision the user already made once.
- *Raw prompts (P1–P3)* — the child runs the stronger model; pre-solving in the prompt anchors it to the weaker model's plan. Repeating mechanics wastes tokens on how-to-talk, which is a non-goal.
- *Hang-listen (K1–K3)* — polling burns turns; timers wake on the wrong event. Platform notifications (Task completion, PR subscription) wake exactly when the awaited thing happened.
- *Resume over duplicate (D3)* — a second child for the same job duplicates cost and creates two competing writers for one outcome.
- *Time by timestamp (T1–T3)* — agents experience time only through their transcripts, where hours compress into adjacent messages; without explicit timestamps and latency budgets, a delayed wake reads as a dead channel and a stale fact reads as current.
- *Blackboard as infra (§6, I4)* — shared state exists so concurrent jobs do not collide; it earns no jobs of its own.

## Conformance

A conversation conforms when all of the following hold:

1. Every job it performed was executed by a cloud child (main) or preceded by an ack (child).
2. Each of its dispatch prompts audits to two parts (P1) with none of the banned content (P2).
3. It holds no timer subscriptions, and its waits are turn-ending subscriptions or Task notifications (§4).
4. No job of its has two live children (D3).
5. Its blackboard writes obey the single-writer/flock/append-only discipline (C2).
6. It judges peers and channels by timestamps against latency budgets, not by transcript adjacency or impatience (T2–T3).

## History

- 2026-08-29 — v0: user sketch stating the goals (dispatch iron law, thin main, raw prompts, one-paste init, communication as infrastructure, hang-listen, ack first, no duplicate Tasks, no invented gates). Superseded by this document, same goals; original text in Git history.
- 2026-08-29 — v1: this RFC-style rewrite by the strong-model worker, at the user's request.
