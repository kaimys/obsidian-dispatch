---
description: Fold everything that arrived since the last edit — inline comments, thread replies, tracker comments, code drift — back into a ticket spec.
argument-hint: <ticket id>
---

# Workflow: update-ticket

Read `dispatch/invariants.md` first. `<ARGS>` is supplied by the invoking agent stub.
Tracker: <<TRACKER>>. Chat: <<CHAT>>. If either is `none`, skip only that integration's lookups, writes and missing-side preconditions; continue the wiki work. With no chat, record questions for the requester in the ticket. A configured but unavailable integration is an error to report, not `none`.

Brings one spec up to date with feedback that landed since its `updated:` date. `<ARGS>` is the ticket id.

## Resolve

1. Find the spec (grep `id: <ARGS>` in `<<WIKI>>/<<TICKETS>>`) and the task in <<TRACKER>>. Stop and report if either is missing.
2. Note the current `updated:` date — it is the cutoff for everything below.
3. **Check `frozen:`.** On a frozen ticket, feedback goes into the record zone as a dated entry; the contract zone stays as built. A wrong frozen statement gets an annotation beneath it (`> ⚠️ Correction <date>: …`), never a rewrite.

## Collect

4. **Inline comments in the note** — `%% … %%` blocks, callouts or blockquotes carrying a remark, `**Name:**` annotations. These are a human's feedback. (Do not confuse them with `<!-- GUIDE: … -->` scaffolding, which is not feedback.)
5. **The thread** named in `discussion:` (<<CHAT>>) — replies newer than the cutoff. If `discussion:` is empty but a thread exists, set it now.
6. **Tracker comments** on the task (<<TRACKER>>).
7. **Code drift** — `git log --since=<cutoff>` for the files the spec names, plus the wiki pages it links. Something that moved under the ticket's feet is feedback too, and it's the kind nobody posts.

## Reconcile

8. Fold it in: update the affected sections, record decisions with who and when, adjust scope and acceptance criteria.
9. **Keep unresolved contradictions visible** as open questions. Do not silently pick a side — ask when a decision is needed. A contradiction quietly resolved by an agent is a decision nobody made.
10. **Delete each inline comment once its content is incorporated** — that is the "resolved" signal, and the reason the note doesn't accumulate stale margin notes. Leave threads, tracker and git history untouched; they are sources, not targets.
11. **Recount `open_questions:`** from the actual unanswered items, `open_tests:` from the unticked test-plan items, and `open_findings:` from the blocking findings of the *latest* `## Code review` entry — earlier entries describe earlier builds and are never added in. Leave `open_findings` empty when no review has run (including a recorded shortcut), or when the code moved after the last one. Leave `open_tests` empty if no coverage assessment/test plan exists; otherwise count its outstanding checks. Never recount acceptance criteria as tests. **A `0` states that the count was taken**, so it needs the section to show it: leave `open_questions` empty when `## Open questions` holds neither an item nor an explicit "none, because …", and by the same rule `open_tests` may stand at `0` when `## Test plan` records why no manual check is needed. Bump `updated:` (confirm the date with `date`).
12. If team decisions were folded in, post one line back in the thread so the team knows the spec now reflects it. Report what changed as a short list.
