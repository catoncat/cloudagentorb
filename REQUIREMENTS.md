# ORB-1: Cloud Orchestrator Standard

Status: Draft
Authority: user (parent bc-f8fde2f5)
Repo: https://github.com/catoncat/cloudagentorb

## Abstract

Main chats dispatch work. Cloud children execute. Init is one paste. Communication is not a product.

## Spec

### Dispatch (MUST)

```
Task(environment="cloud", model="claude-fable-5-thinking-xhigh")
```

New child each job. This model slug only. No other worker model.

### Prompt (MUST)

1. User need (lightly copy-edited).
2. Background required to finish.
3. Nothing else.

MUST NOT: solution, design, extra briefing, permission gates, thresholds — unless the user named them.

### Main chat (MUST)

Full git/Cursor/gh rights. Thin context: long-lived, weaker model, many dispatches. MUST NOT implement, research the bus, or pre-solve.

Follow-up to an existing IDLE child: `Task(resume)`. MUST NOT spawn a competing child for the same job.

### Init (MUST)

One paste from cloudagentorb onto any new conversation and any new repo. After init, new mains and new children already know this standard.

### Shared state (MUST)

Payload: `/cursor/stores/user/` (user-wide).
MUST NOT treat `/workspace` or sibling `self` stores as shared.

### Wake (MUST)

No tight poll. No `subscribe_timer` as everyday wake.
Idle main: `subscribe_github_pr` then end turn.
Idle child: `resume` or PR comment.
Finished child: Task completion notification.
Receipt: child writes ack first, then works.

### Non-goals (MUST NOT)

Bus demos as the ticket. Token spend on how-to-talk. Duplicate Tasks. Restricting child rights without user request.
