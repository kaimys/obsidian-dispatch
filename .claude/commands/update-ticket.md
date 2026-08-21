---
description: Fold everything that arrived since the last edit — inline comments, thread replies, tracker comments, code drift — back into a ticket spec.
argument-hint: <ticket id>
---

# /update-ticket $ARGUMENTS

Brings one spec up to date with feedback that landed since its `updated:` date. `$ARGUMENTS` is the ticket id.

## Resolve

1. Find the spec (grep `id: $ARGUMENTS` in `docs/wiki/02_Requirements/Tickets`) and the task in the GitHub Issues of `kaimys/obsidian-dispatch`, via the GitHub MCP or the `gh` CLI. Stop and report if either is missing.
2. Note the current `updated:` date — it is the cutoff for everything below.
3. **Check `frozen:`.** On a frozen ticket, feedback goes into the record zone as a dated entry; the contract zone stays as built. A wrong frozen statement gets an annotation beneath it (`> ⚠️ Correction <date>: …`), never a rewrite.

## Collect

4. **Inline comments in the note** — `%% … %%` blocks, callouts or blockquotes carrying a remark, `**Name:**` annotations. These are a human's feedback. (Do not confuse them with `<!-- GUIDE: … -->` scaffolding, which is not feedback.)
5. **The thread** named in `discussion:` (none) — replies newer than the cutoff. If `discussion:` is empty but a thread exists, set it now.
6. **Tracker comments** on the task (the GitHub Issues of `kaimys/obsidian-dispatch`, via the GitHub MCP or the `gh` CLI).
7. **Code drift** — `git log --since=<cutoff>` for the files the spec names, plus the wiki pages it links. Something that moved under the ticket's feet is feedback too, and it's the kind nobody posts.

## Reconcile

8. Fold it in: update the affected sections, record decisions with who and when, adjust scope and acceptance criteria.
9. **Keep unresolved contradictions visible** as open questions. Do not silently pick a side — ask when a decision is needed. A contradiction quietly resolved by an agent is a decision nobody made.
10. **Delete each inline comment once its content is incorporated** — that is the "resolved" signal, and the reason the note doesn't accumulate stale margin notes. Leave threads, tracker and git history untouched; they are sources, not targets.
11. **Recount `open_questions:`** from the actual unanswered items, and `open_tests:` from the unticked test-plan items. Bump `updated:` (confirm the date with `date`).
12. If team decisions were folded in, post one line back in the thread so the team knows the spec now reflects it. Report what changed as a short list.
