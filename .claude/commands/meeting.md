---
description: Meeting support in two modes — build the agenda from the board before, turn the transcript into a report with decisions folded into the tickets after.
argument-hint: agenda|report <date> <title>
---

# /meeting $ARGUMENTS

Two modes over the meeting notes in `wiki/09_Meetings-and-Workshops` (`YYYY-MM-DD - <title>.md`). `$ARGUMENTS` starts with `agenda` or `report`, followed by the date and/or title identifying the meeting.

---

## Mode: agenda (before)

1. Confirm the date with `date`. Locate or create the note from `wiki/00_Start-Here/Templates/meeting.md`.
2. **Build the agenda from the board, not from memory.** Pull:
   - open refinement questions (`open_questions > 0`) — the ones actually blocking, ranked by what they hold up
   - tickets waiting for manual sign-off (`open_tests > 0`)
   - what blocks the next version on the Release Plan
   - decisions from the previous meeting whose `decisions_folded:` is still empty
3. Write it as a **decision-oriented** agenda: each item names what is being decided and who decides it. An agenda of topics produces a meeting of topics.

---

## Mode: report (after)

4. **Locate the transcript in `wiki/09_Meetings-and-Workshops/Transcripts/`** (Google's own filename — `<Title> - <date> - Transcript by Gemini.md`, or the `… - Notes by Gemini.md` summary if no transcript exists). Never edit it; it is a raw source, and a wrong interpretation must always be redoable from it.
   **Not there yet?** Stop and ask to download it by hand (open the Gemini notes or transcript in Google Docs → File → Download → Markdown, into that folder). Automatic fetch on click is scoped in [[Story - US00001 - Import Google Meet transcripts automatically|US00001]] and not built yet — this command does not depend on it.
5. Write the report into the meeting note: summary, **decisions** (each with who decided and the ticket ids it affects), and action items.
6. **Action items go in `## Action items` as `- [ ]` checkbox lines**, with an owner as a bold line above a group or an inline `**Name:**` prefix. **The Todos tab parses exactly this format** — a prose paragraph of "Kai will look into X" is invisible to the board. Set `open_actions:` to the number of unchecked items.
7. **Fold the decisions into the affected tickets — this is the step everyone skips, and the reason it matters is that a decision living only in a meeting note has to be rediscovered by whoever next opens the ticket, and won't be.** For each decision: update the ticket, recording who decided and when. **Check `frozen:` first** — on a frozen ticket append a dated entry to the record zone or open a follow-up, never edit the contract zone. Recount `open_questions:` on anything a decision answered.
8. Stamp `decisions_folded:` with today's date once step 7 is genuinely done. Empty means the meeting's outcomes haven't landed yet — that is the property worth checking, since "historical" is what every meeting note eventually becomes and carries no information.
9. Report which tickets changed.

**Meeting notes are never authoritative.** Durable outcomes get promoted into tickets or ADRs; the note stays as the record of when it was said.
