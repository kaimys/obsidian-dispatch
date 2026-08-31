---
description: Create a new ticket from a short description — duplicate check, spec from the template with full frontmatter, and the matching tracker task.
argument-hint: short description + where it came from
---

# /create-ticket $ARGUMENTS

Creates one ticket. `$ARGUMENTS` is a short description, ideally with a source pointer (a report row, a meeting note, a thread, a bug report).

## Prepare

1. Confirm today's date with `date` — for `updated:` and the log entry. Never guess it.
2. **Read the source** the description points at, plus the wiki pages and code it touches, so the spec carries real context instead of the one-liner. A ticket that only restates its title makes refinement start from zero.
3. **Duplicate check:** search `wiki/05_Requirements/Tickets` and the GitHub Issues of `kaimys/obsidian-dispatch`, via the GitHub MCP or the `gh` CLI for the topic. If a matching ticket exists, stop and report it — do not create a near-duplicate.
4. **Determine the id:** 5 digits, prefixed by `type` — `US` story · `BUG` bug · `SEC` security (`US00042`, `BUG00007`, `SEC00001`). **Each prefix counts separately**, so a new one starts at `00001`; number highest-existing-of-that-prefix + 1. Check both systems, so a task created directly in the tracker doesn't collide. Nothing parses the ID shape — `move-ticket.mjs` reads `id` as an opaque string — so a prefix is a naming convention, and adding one means updating this line and `CLAUDE.md`, nothing else. The file is named `<Type> - <ID> - <Short name>.md`, with `<Type>` matching `type:` (`Security - SEC00001 - …`).

## Create — both systems, never one-sided

5. **Spec:** `wiki/05_Requirements/Tickets/<Type> - <ID> - <Short name>.md`, started from `wiki/00_Start-Here/Templates/ticket-story.md` (bugs: `ticket-bug.md`). Fill the frontmatter — `id`, `type`, `status: "Backlog"`, `priority`, `rank` (highest in the column + 1000), `size` if estimable, `assignee` only if actually decided, `updated`, `open_questions: <number of questions you drafted>`, `open_tests: 0`, `owner`. Leave `version_target` empty unless it is genuinely known.
6. **Fill what creation can support:** the summary line, User story (bugs: Symptom — observed vs. expected), Context with links to the source, Open questions, and a first Scope / Out of scope. Leave Acceptance criteria, Implementation plan and Test plan to the commands that own them. **Strip the `<!-- GUIDE: … -->` of every section you fill; leave the rest.**
7. **Tracker issue** — GitHub Issues on `kaimys/obsidian-dispatch` (GitHub MCP, or `gh issue create`): title `<ID> <short name>`, body = a 2–3 line summary plus the spec's path, label `bug` or `enhancement` to match `type`. GitHub has no columns, so a new issue is simply open. Put the issue URL into the spec's `discussion:` frontmatter — that is the property `scripts/dispatch/move-ticket.mjs` reads to find the issue when the card is dragged, so a ticket without it will never sync. **Ask the user before opening the issue:** the repository is public and an issue is outward-facing.
8. **Never paste chip buttons into the note** — the board renders chips virtually, and a pasted one goes stale.

## Images

9. **A screenshot in the report is part of the spec, not of the conversation.** Store it in `wiki/05_Requirements/Tickets/images/` as `<ID>-<short-description>.<ext>` (keep the original format, don't re-encode), embed it with `![[<filename>]]` in the section it evidences — bugs: `## Symptom`, stories: `## Context` — followed by a one-line italic caption, and note the stored path under `## References`.
10. ⚠️ **An image pasted into a chat session is not on disk.** Find the source file before copying — check `~/Downloads` and the OS screenshot folder by modification time — and **read the candidate to confirm it is the same image**. A wrong screenshot in a bug ticket is worse than none. If it genuinely isn't on disk, say so and ask for it.

## Close

11. Register the ticket where the wiki expects it (index page, `log.md` entry), and report the new id with paths/links to both systems.
