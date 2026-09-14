# Starter note templates

Copy these into the **vault** (`<<TEMPLATES>>`, e.g. `00_Start-Here/Templates/`) — unlike the commands, which live in the code repo. The frontmatter contract they implement is documented in [`docs/page-types.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md).

Replace the `<<PLACEHOLDER>>` tokens (same vocabulary as `../commands/README.md`), including the completion property used by both templates and completion-writing workflows:

| Placeholder | Is | Example |
| --- | --- | --- |
| `<<P_COMPLETED>>` | the completion-date property — must equal `milestones.completedProperty` in `data.json`, and be stamped on completion by a board drag automation or explicitly by the writing workflow | `deployed` |

Then grep for `<<` to prove none survived.

## These are not cosmetic

Three of them are **parsed by the plugin**. Getting the format wrong doesn't produce an ugly note — it produces a board that silently omits things:

| Template | What the plugin reads | Symptom if it's wrong |
| --- | --- | --- |
| `ticket-story.md`, `ticket-bug.md` | all card frontmatter | card missing, in the wrong column, or flagged by the ⚠ panel |
| `release-note.md` | `version` + `date` | the release never links from the Release Plan |
| `meeting.md` | `- [ ]` lines under the allowlisted section, bold owner labels | action items invisible on the Todos tab |
| `adr.md` | nothing — for humans and agents only | — |

## The two comment conventions

Both are invisible in Obsidian's reading view, and they mean different things. Keep them distinct, or `/update-ticket` cannot tell scaffolding from feedback:

- **`<!-- GUIDE: … -->`** — scaffolding. Written by the template, stripped by whichever command fills that section. Guides on sections nobody has touched yet stay, so the next agent still sees them.
- **`%% … %%`** — a human's inline comment on the note. `/update-ticket` folds it into the spec and then deletes it; that deletion is the "resolved" signal.

## The zone markers

The ticket templates mark a **contract zone** and a **record zone** with banner comments, because [the freeze rule](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md#the-freeze-rule) is far easier to follow when the boundary is visible while writing than when it lives in a document somewhere. Contract = what the implementation was built against, frozen when the ticket leaves development. Record = what actually happened, always appendable.

The freeze and correction-by-annotation are part of the method. Adapt the column names, not this boundary. The small-bug shortcut finalizes the contract and stamps `frozen:` before completion too.

## Adapting

Section headings are the part most worth changing — they encode the questions your project actually needs asked at creation time. What to preserve:

- the **frontmatter keys** the board reads (they must match `data.json`)
- **`- [ ]` checkboxes** in Open questions, Test plan and Action items — the counters and the Todos tab are derived from them
- **one section per counter**, so `open_questions`, `open_findings` and `open_tests` each have exactly one place to be recounted from (Open questions, `## Code review`, Test plan)

A `## Dispatch runs` heading is included in the ticket templates so agent run logs land somewhere predictable; the lifecycle hook appends it anyway if it's missing.
