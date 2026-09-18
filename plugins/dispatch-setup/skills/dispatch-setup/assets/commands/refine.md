---
description: Start or continue refinement of a ticket — read the spec and everything it links, put the open questions where the team talks, drive them to zero.
argument-hint: <ticket id>
---

# Workflow: refine

Read `dispatch/invariants.md` first. `<ARGS>` is supplied by the invoking agent stub.
Tracker: <<TRACKER>>. Chat: <<CHAT>>. If either is `none`, skip only that integration's lookups, writes and missing-side preconditions; continue the wiki work. With no chat, record questions for the requester in the ticket. A configured but unavailable integration is an error to report, not `none`.

Runs refinement for one ticket. `<ARGS>` is the ticket id.

## Resolve

1. Find the spec: grep `id: <ARGS>` in `<<WIKI>>/<<TICKETS>>`. Find the matching task in <<TRACKER>>. If either side is missing, stop and report it — don't refine a one-sided ticket.
2. Name the session `<ARGS> <short name>` so the terminal is identifiable.
3. **Check `frozen:`.** If set, the contract zone is closed: do not reopen it. Either append to the record zone or propose a follow-up ticket, and say which you did.

## Refine

4. **Read the spec and everything it links** — wiki pages, ADRs, the thread in `discussion:`, tracker comments, the code paths it names, related tickets. Verify claims against the code; a wiki page is a claim about the system, not the system.
5. **Collect open questions and contradictions** — inside the spec, and spec vs. code / design / other tickets. Include anything the spec is silent about that an implementer would otherwise have to guess. Silence is the expensive kind of ambiguity: it isn't visible until someone builds the wrong thing.
6. **Put them where the team already talks** (<<CHAT>>): if the ticket has no refinement post yet, post a short summary of the open questions and add the permalink under `## References`; if a post exists, **continue that thread** instead of starting a second one. Either way set frontmatter `discussion:` to the thread permalink — the board renders it as a chat icon on the card.
7. Move the ticket to `<<S_REFINEMENT>>` in both systems if it isn't there.
8. **Work the questions through with the user.** Use one focused question at a time rather than a wall of them. Record every answer in the spec with who decided and when — the answer is the durable artifact, the thread is not. Sharpen the acceptance criteria as answers land.
9. **Maintain the counter:** keep `open_questions:` equal to the number of still-unanswered items. It is the gate out of refinement and the amber `? N` badge on the card. An item marked answered or explicitly deferred does not count.
10. Strip the `<!-- GUIDE: … -->` of every section you write into. Bump `updated:`.

## Close

11. **Refinement ends when the user says so**, not when the questions run out. Then acceptance criteria are final and testable, `open_questions: 0`, and `version_target:` is set. If refinement opened no question at all, record an explicit "none, because …" in `## Open questions` before writing that `0` — the counter claims a count was taken, and on such a ticket nothing else in the spec says one was. Leave the ticket in `<<S_REFINEMENT>>`; do not move it merely because you answered the questions. The human may explicitly authorize a move to the optional `<<S_READY_DEV>>` queue, or invoke development directly. **`size:` is not a gate** — set it when known; a missing value means weight 1.
12. If the ticket is non-trivial, suggest `/implementation-plan <ARGS>` before development.
13. **Stop instead of guessing** when a question needs a product decision, has no owner, or touches something safety- or legally-critical. Leave the status where a human will see it and say what you're waiting on.
