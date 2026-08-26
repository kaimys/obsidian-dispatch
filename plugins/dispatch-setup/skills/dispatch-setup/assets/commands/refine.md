---
description: Start or continue refinement of a ticket — read the spec and everything it links, put the open questions where the team talks, drive them to zero.
argument-hint: <ticket id>
---

# /refine $ARGUMENTS

Runs refinement for one ticket. `$ARGUMENTS` is the ticket id.

## Resolve

1. Find the spec: grep `id: $ARGUMENTS` in `<<WIKI>>/<<TICKETS>>`. Find the matching task in <<TRACKER>>. If either side is missing, stop and report it — don't refine a one-sided ticket.
2. Name the session `$ARGUMENTS <short name>` so the terminal is identifiable.
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

11. **Refinement ends when the user says so**, not when the questions run out. Then: acceptance criteria final and testable, `open_questions: 0`, `version_target:` set, status → `<<S_READY_DEV>>` in both systems. **`size:` is not a gate** — it is a numeric weight for progress and the velocity forecast, and a missing value already means 1. Set it when it is known; never hold a refined ticket for it.
12. If the ticket is non-trivial, suggest `/implementation-plan $ARGUMENTS` before development.
13. **Stop instead of guessing** when a question needs a product decision, has no owner, or touches something safety- or legally-critical. Leave the status where a human will see it and say what you're waiting on.
