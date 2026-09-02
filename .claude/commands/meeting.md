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

4. **Locate the meeting's document in `wiki/09_Meetings-and-Workshops/Transcripts/`** — Google's own filename, `<Title> - <YYYY_MM_DD HH_MM TZ> - Notes by Gemini.md`. **One file holds both** the Gemini summary and the transcript with speaker labels; Google stopped producing a separate `Transcript by Gemini` file. Never edit it; it is a raw source, and a wrong interpretation must always be redoable from it.

   **Not there yet? Fetch it** — from the repo root:
   ```bash
   node scripts/dispatch/meet-fetch.mjs --title "<meeting title>" --date <YYYY-MM-DD> \
     --dir wiki/09_Meetings-and-Workshops/Transcripts
   ```
   It prints one line and is safe to re-run: presence is checked by `doc_id`, so a document already fetched is never downloaded twice, and renaming a file on disk does not cause a re-download. Add ` HH:MM` to `--date` only if the same meeting ran twice that day.

   **`--date` is the key, `--title` only disambiguates.** Google names the document after the *calendar event*, which need not match the note — on 2026-09-01 the note was "Dispatch Introduction" and the document "Einführung in Dispatch". So pass the date from the note's `meeting_date` (or its filename) and do not worry if the title is a translation or a rename; the script matches on the date and tells you when the titles disagree.

   Four outcomes, all reported on that one line:
   - **Fetched, transcript present** — proceed to step 5.
   - **Fetched, `NO TRANSCRIPT`** — transcription was off for the meeting and only the summary exists. Write the report from the summary and **say so in the note**, rather than implying dialogue was read.
   - **`Note: matched on the date alone`** — the document's title differs from what you asked for and it was the only meeting that day. Check the named title is plausibly the same meeting, then proceed.
   - **No document matched** — the script prints every document it considered, and if that list is empty, every Gemini document in reach with its parsed title and date. **Read that list before concluding anything**; the answer is usually one line in it. If the meeting genuinely is not there, Gemini has not generated it yet (it lags the meeting) or the meeting was never recorded — stop and report, and never invent a report from the agenda.

   `node scripts/dispatch/meet-fetch.mjs --list` shows the same inventory at any time.

   **Two recoverable errors. Run the fix yourself — never hand the user a command to paste.** You have a shell; asking someone to copy a line back into the terminal you are already holding is work you are supposed to be doing.

   - **`Could not tell which vault's settings to use`** — more than one vault on the machine. The error lists the device files; pick the one whose name matches this vault (`Dispatch-Wiki-<hash>.json` here) and re-run with `--config "<that path>"`. Do not ask which one.
   - **`The stored refresh token is no longer valid`** — first run on this machine, or the grant was revoked. **Run the exact `--auth` command the error prints**, including its `--config`. It prints a Google URL and then blocks on a local callback: show the user that URL, tell them to complete the consent in the browser (an "unverified app" screen is expected — *Advanced → Go to Dispatch*), and let the command finish on its own. Give it a long timeout, because it waits for a human. When it reports the token stored, re-run the fetch and carry on with step 5.

   Only stop and ask the user when something needs a decision or a credential you cannot supply — a Cloud Console setup that has never been done, or a document that genuinely does not exist. Setup is in `docs/installation.md`.
5. Write the report into the meeting note: summary, **decisions** (each with who decided and the ticket ids it affects), and action items.
6. **Action items go in `## Action items` as `- [ ]` checkbox lines**, with an owner as a bold line above a group or an inline `**Name:**` prefix. **The Todos tab parses exactly this format** — a prose paragraph of "Kai will look into X" is invisible to the board. Set `open_actions:` to the number of unchecked items.
7. **Fold the decisions into the affected tickets — this is the step everyone skips, and the reason it matters is that a decision living only in a meeting note has to be rediscovered by whoever next opens the ticket, and won't be.** For each decision: update the ticket, recording who decided and when. **Check `frozen:` first** — on a frozen ticket append a dated entry to the record zone or open a follow-up, never edit the contract zone. Recount `open_questions:` on anything a decision answered.
8. Stamp `decisions_folded:` with today's date once step 7 is genuinely done. Empty means the meeting's outcomes haven't landed yet — that is the property worth checking, since "historical" is what every meeting note eventually becomes and carries no information.
9. Report which tickets changed.

**Meeting notes are never authoritative.** Durable outcomes get promoted into tickets or ADRs; the note stays as the record of when it was said.
