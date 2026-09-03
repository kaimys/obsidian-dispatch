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

   **Not there yet?** There are two ways it gets there, and the ordinary one needs no setup.

   **The default: ask for it.** Say which meeting you need and what to do — *open the Gemini document in Google Docs and use File → Download → Markdown for **both tabs** (Notizen and Transkript), then drop the files in `wiki/09_Meetings-and-Workshops/Transcripts/`* — then stop and wait. When the files appear, step 4 finds them and nothing else changes. This is not a fallback or a degraded path; it is how most people will always do it, and a report written from a hand-downloaded file is identical to one written from a fetched file.

   **The optional automated import.** If the `google` block is configured in this vault's device file (`~/.dispatch/<vault>-<hash>.json`), the download is skipped and you fetch it yourself — from the repo root:
   ```bash
   node scripts/dispatch/meet-fetch.mjs --title "<meeting title>" --date <YYYY-MM-DD> \
     --dir wiki/09_Meetings-and-Workshops/Transcripts
   ```
   **Check whether it is configured before reaching for it**, and if it is not, take the default above rather than walking someone through a Google Cloud project mid-report. Setting it up is a deliberate act — a Cloud project, an OAuth consent screen on a verified domain — worth it for a team or a recurring series, not for one meeting. `docs/installation.md` has it; offer it, never impose it.

   The rest of this step describes the import, and only applies when it is configured.

   It prints one line and is safe to re-run: presence is checked by `doc_id`, so a document already fetched is never downloaded twice, and renaming a file on disk does not cause a re-download. Add ` HH:MM` to `--date` only if the same meeting ran twice that day — the time separates two candidates and is ignored when it matches none, so a guessed hour cannot hide the meeting.

   **`--date` is the key, `--title` only disambiguates.** Google names the document after the *calendar event*, which need not match the note — on 2026-09-01 the note was "Dispatch Introduction" and the document "Einführung in Dispatch". So pass the date from the note's `meeting_date` (or its filename) and do not worry if the title is a translation or a rename; the script matches on the date and tells you when the titles disagree.

   Six outcomes, all reported as the run happens:
   - **Fetched, transcript present** — proceed to step 5.
   - **Fetched, `NO TRANSCRIPT`** — transcription was off for the meeting and only the summary exists. Write the report from the summary and **say so in the note**, rather than implying dialogue was read.
   - **`Note: matched on the date alone`** — the document's title differs from what you asked for and it was the only meeting that day. Check the named title is plausibly the same meeting, then proceed.
   - **`WARNING: this document is from <other date>`** — **stop and check before writing anything.** Google attaches a meeting's notes to a recurring event's *next* occurrence as well, so an upcoming event can carry the previous run's document; measured on this vault's own series on 2026-09-03. Run `--list`, find the row whose document belongs to the meeting you are reporting on, and fetch it with `--doc`. Never write a report from a document whose date you could not account for.
   - **`WARNING: this event has N Gemini documents`** — several conferences ran against one calendar entry (a call that dropped and was rejoined, or a series started more than once), and the first was taken. **Check before writing.** Read the fetched document's title: it carries the conference's own start time. If it is not the meeting you are reporting on, re-run with one of the `--doc` lines the warning prints. They are all the same day, so nothing else will flag this for you.
   - **No document matched** — the script prints every document it considered, and if that list is empty, every Gemini document in reach with its parsed title and date. **Read that list before concluding anything**; the answer is usually one line in it. If the meeting genuinely is not there, Gemini has not generated it yet (it lags the meeting) or the meeting was never recorded — stop and report, and never invent a report from the agenda.

   `node scripts/dispatch/meet-fetch.mjs --list` shows the same inventory at any time.

   **Three recoverable errors. Run the fix yourself — never hand the user a command to paste.** You have a shell; asking someone to copy a line back into the terminal you are already holding is work you are supposed to be doing.

   - **`does not look like a Gemini meeting document`** — the calendar event carries more than one document (an agenda, a deck) and the wrong one was taken. Nothing was written. Run `--list`, read the row for that meeting — it names the attachment it chose — and re-run with `--doc <the notes document's url or id>`.
   - **`Could not tell which vault's settings to use`** — more than one vault on the machine, and the run was not started from a chip (a chip launch sets `DISPATCH_LOCAL_SETTINGS`, which answers this). The error lists the device files; pick the one whose name matches this vault (`Dispatch-Wiki-<hash>.json` here) and re-run with `--config "<that path>"`. Do not ask which one.
   - **`The stored refresh token is no longer valid`** — the import is configured but not yet authorised on this machine, or the grant was revoked. (No `google` block at all is not this error, and not a problem: take the default and ask for the download.) **Ask first, then run it.** This opens a browser and asks for access to the user's Google Docs, so say so plainly and give them the choice — something like:

     > *"To fetch the transcript I need your permission once, to read the Gemini document for this meeting. It opens a Google consent page in your browser and asks for read-only access to your Google Docs — nothing in your Drive. Shall I go ahead? If you'd rather not, you can download the document yourself instead: open it in Google Docs, and for **both tabs** (Notizen and Transkript) use File → Download → Markdown, then drop the files in `wiki/09_Meetings-and-Workshops/Transcripts/`. I'll work from those."*

     Both answers are fine and neither needs persuading. **If they agree:** run the exact `--auth` command the error prints, including its `--config`, and **keep waiting in that same tool call until it returns.** It opens the consent page itself and then blocks on a local callback; an "unverified app" screen is expected (*Advanced → Go to Dispatch*). Give it a long timeout — several minutes — because it is waiting for a human. When it reports the token stored, re-run the fetch and carry on with step 5. **If they decline:** stop and wait for the files; once they are in the folder, step 4 finds them and nothing else changes.

     ⚠️ **Do not relay the URL and end your turn.** The loopback server only exists while that process runs, so finishing your turn kills it and the redirect lands on nothing — the consent then fails no matter what the user does. The script opens the browser precisely so you never have to hand the URL over. Say what is happening if you like, but say it *while the call is still running*, not instead of it.

   Only stop and ask the user when something needs a decision or a credential you cannot supply — a Cloud Console setup that has never been done, or a document that genuinely does not exist. Setup is in `docs/installation.md`.
5. Write the report into the meeting note: summary, **decisions** (each with who decided and the ticket ids it affects), and action items.
6. **Action items go in `## Action items` as `- [ ]` checkbox lines**, with an owner as a bold line above a group or an inline `**Name:**` prefix. **The Todos tab parses exactly this format** — a prose paragraph of "Kai will look into X" is invisible to the board. Set `open_actions:` to the number of unchecked items.
7. **Fold the decisions into the affected tickets — this is the step everyone skips, and the reason it matters is that a decision living only in a meeting note has to be rediscovered by whoever next opens the ticket, and won't be.** For each decision: update the ticket, recording who decided and when. **Check `frozen:` first** — on a frozen ticket append a dated entry to the record zone or open a follow-up, never edit the contract zone. Recount `open_questions:` on anything a decision answered.
8. Stamp `decisions_folded:` with today's date once step 7 is genuinely done. Empty means the meeting's outcomes haven't landed yet — that is the property worth checking, since "historical" is what every meeting note eventually becomes and carries no information.
9. Report which tickets changed.

**Meeting notes are never authoritative.** Durable outcomes get promoted into tickets or ADRs; the note stays as the record of when it was said.
