---
description: Meeting support in two modes — build the agenda from the board before, turn the transcript into a report with decisions folded into the tickets after.
argument-hint: agenda|report <date> <title>
---

# /meeting $ARGUMENTS

Two modes over the meeting notes in `<<WIKI>>/<<MEETINGS>>` (`YYYY-MM-DD - <title>.md`). `$ARGUMENTS` starts with `agenda` or `report`, followed by the date and/or title identifying the meeting.

---

## Mode: agenda (before)

1. Confirm the date with `date`. Locate or create the note from `<<WIKI>>/<<TEMPLATES>>/meeting.md`.
2. **Build the agenda from the board, not from memory.** Pull:
   - open refinement questions (`open_questions > 0`) — the ones actually blocking, ranked by what they hold up
   - tickets waiting for manual sign-off (`open_tests > 0`)
   - what blocks the next version on the Release Plan
   - decisions from the previous meeting whose `decisions_folded:` is still empty
3. Write it as a **decision-oriented** agenda: each item names what is being decided and who decides it. An agenda of topics produces a meeting of topics.
4. Announce it in <<CHAT>> so the team can add to it, and store that thread's permalink in the note's `discussion:`.

---

## Mode: report (after)

5. **Read the transcript from `<<WIKI>>/<<SOURCES>>` together with the thread** in `discussion:`. The thread usually carries the context the transcript lacks — links, numbers, what people meant. Never edit the transcript; it is a raw source, and a wrong interpretation must always be redoable from it.
6. Write the report into the meeting note: summary, **decisions** (each with who decided and the ticket ids it affects), and action items.
7. **Action items go in the allowlisted section as `- [ ]` checkbox lines**, with an owner as a bold line above them or an inline `**Name:**` prefix. **The Todos tab parses exactly this format** — a prose paragraph of "Alex will look into X" is invisible to the board. Set `open_items:` to the number of unchecked items.
8. **Fold the decisions into the affected tickets — this is the step everyone skips, and the reason it matters is that a decision living only in a meeting note has to be rediscovered by whoever next opens the ticket, and won't be.** For each decision: update the ticket, recording who decided and when. **Check `frozen:` first** — on a frozen ticket append a dated entry to the record zone or open a follow-up, never edit the contract zone. Recount `open_questions:` on anything a decision answered.
9. Stamp `decisions_folded:` with today's date once step 8 is genuinely done. Empty means the meeting's outcomes haven't landed yet — that is the property worth checking, since "historical" is what every meeting note eventually becomes and carries no information.
10. Post a short summary back in the thread and report which tickets changed.

**Meeting notes are never authoritative.** Durable outcomes get promoted into tickets or ADRs; the note stays as the record of when it was said.
