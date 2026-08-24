---
description: Write the implementation plan for a refined ticket — stored in the ticket as the review surface — then extract durable decisions into ADRs.
argument-hint: <ticket id>
---

# /implementation-plan $ARGUMENTS

Produces the implementation plan for one refined ticket. `$ARGUMENTS` is the ticket id.

## Prepare

1. Resolve the ticket (spec via `id: $ARGUMENTS` in `docs/wiki/05_Requirements/Tickets`, task in the GitHub Issues of `kaimys/obsidian-dispatch`, via the GitHub MCP or the `gh` CLI) and name the session `$ARGUMENTS <short name>`.
2. **Run the `/update-ticket` steps first.** Never plan against a stale spec — the thread usually moved after the last edit.
3. **Verify ground truth**: read the code the ticket touches, not just the description of it. Check external contracts (APIs, schemas, designs) against their actual current state.
4. **Read the ADR index** (`docs/wiki/07_Engineering/Decisions`) for the areas in scope. Plan *within* the accepted decisions. If the ticket requires contradicting one, that is a decision to reopen — surface it, don't quietly work around it.
5. Confirm refinement actually closed: `open_questions: 0`. If a decision the plan depends on is still open, finish refinement first rather than planning around a hole.

## Plan

6. Draft in **plan mode**. Cover:
   - the concrete files/modules that change, and how
   - external changes (schema, API, infrastructure) and their migration order
   - tests: which layer asserts what, and what the change makes newly assertable
   - which wiki pages this makes wrong, and who updates them
   - risks, rollback, and anything that must ship in a particular order — **with the reason**, because an order without reasons gets optimized away by the next person
   - a rough size estimate in whatever unit the project actually uses; say it's an order of magnitude, not a commitment
7. **Store the plan in the ticket — that is the review surface. Never gate on `ExitPlanMode`.** Write it as the spec's `## Implementation plan` section (replacing any existing one), strip that section's `<!-- GUIDE: … -->`, bump `updated:`. The user reviews and iterates *in the ticket*; fold their feedback back into that section. Clarifying questions belong *before* you write it, not as an approval prompt after.

## Extract ADRs

8. Once the plan is signed off, scan the refined spec **and** the plan for decisions that belong in the ADR log — this is the moment they are settled but not yet buried in prose. A decision qualifies when **all four** hold:
   - **durable** — it governs work beyond this ticket
   - **cross-cutting** — a later ticket in this area must obey it
   - **non-obvious** — it has a rationale, a rejected alternative, or is a deliberate "we do *not* do X"
   - **still true** — it is the current decision, not a superseded step along the way

   Typical: data-model shape, privacy/safety rules, auth invariants, platform constraints and their workarounds, conventions later tickets must follow. **Not** ADRs: ticket-local detail, open questions, restatements of the code, or a decision that merely *applies* an existing ADR — link that ADR from the ticket instead.
9. For each qualifying decision: write `docs/wiki/07_Engineering/Decisions/ADR-00xx - <Short title>.md` from `docs/wiki/00_Start-Here/Templates/adr.md` (next free number, `date` = when it was actually decided, `status: accepted` — or `proposed` if agreed but not yet built). **Record the rejected alternatives**; half an ADR's value is the deliberate "no". If it contradicts an existing ADR, mark the old one `superseded` with `superseded_by:` pointing forward — never delete it. Link the ADR from the ticket and the ticket from the ADR.
10. Name any ADRs created or superseded when you report. If a decision looks durable but is still contested, leave it in the ticket and flag it as needing a decision rather than minting an ADR that isn't settled.

## Close

11. The ticket stays in `Backlog` once the plan is signed off — on this board the plan is a gate, not a column. Suggest `/develop $ARGUMENTS`.
