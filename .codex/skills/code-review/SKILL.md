---
name: code-review
description: Review a ticket's branch against its acceptance criteria, plan and code — findings with file, line and fix, recorded in the ticket — and block the hand-off to /test-plan when a criterion fails.
---

# code-review

Every step of this workflow lives in one file, shared by all agents:
**`dispatch/workflow/code-review.md`**. Read it now and follow it exactly — this file
carries no steps of its own.

Wherever it says `<ARGS>`, substitute the arguments you were
invoked with (`<ticket id>`).
