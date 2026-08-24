---
description: Implement a ticket — precondition checks, status move, code with tests, gates green, then hand off to /test-plan.
argument-hint: <ticket id>
---

# /develop $ARGUMENTS

Runs development for one ticket. `$ARGUMENTS` is the ticket id.

## Start

1. Resolve the ticket (spec via `id: $ARGUMENTS` in `docs/wiki/05_Requirements/Tickets`, task in the GitHub Issues of `kaimys/obsidian-dispatch`, via the GitHub MCP or the `gh` CLI) and name the session `$ARGUMENTS - <shortened title>` (e.g. `US00042 - Import Meet transcripts`).
2. **Pull the default branch first**, then branch off the freshly pulled tip. A stale base forces an avoidable merge later, and on a shared repo it happens within a day.
3. **Preconditions** — expected status is `Refinement` (or `Backlog`, for a ticket small enough that refinement never opened a question), acceptance criteria are final, `open_questions: 0`, and for anything non-trivial an `## Implementation plan` exists. If something is missing, say so and suggest `/refine` or `/implementation-plan`. **Do not code around a missing decision** — that is how a guess becomes a shipped behaviour nobody chose.
4. Move to `In progress` in both systems, set `assignee:` to whoever is doing the work, and strip leftover `<!-- GUIDE: … -->` from sections you finalise.

## Implement

5. **Read before writing** — the affected code, the plan, the linked wiki pages. Make the smallest change that fully solves the ticket, and match the surrounding code's style, naming and structure rather than importing your own.
6. Follow the plan. If reality contradicts it, stop and update the plan in the ticket *first*, saying what changed — a plan silently abandoned mid-implementation leaves the review with no baseline.
7. **Tests are part of the change, not a follow-up.** Every new unit of behaviour gets a test at the layer that can assert it cheaply. Never weaken an existing assertion to make a change pass; if an assertion is wrong, that is its own visible decision.
8. Commit with the ticket reference so the release note can be generated from history: `<type>(<scope>): <what> ($ARGUMENTS)`.

## Finish

9. **Gates, all green — no exceptions and no "unrelated failure" without evidence:**
   ```
   npm run build && npm run lint && npm test
   ```
   For user-facing changes, also run the app and confirm the affected surface actually behaves as the acceptance criteria say. A green suite is not a demonstration that the feature works.
10. **Update the wiki pages this change made wrong.** The docs go stale in exactly this step, every time.
11. When code-complete and green, finish with **`/test-plan $ARGUMENTS`** — it writes the manual plan, sets `open_tests`, stamps the freeze and performs the move to `Review`. Do not make that move by hand; the gate belongs to that command.
