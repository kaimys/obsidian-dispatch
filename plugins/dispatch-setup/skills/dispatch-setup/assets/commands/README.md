# Starter workflow commands

A generic, adaptable implementation of the catalog in [`docs/skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md). Copy these into the **code repository** as `.claude/commands/*.md` — never into the wiki (see the wiki=state / repo=process boundary in that doc) — then replace every `<<PLACEHOLDER>>`.

Dispatch ships these as a *starting point*, not a standard. They encode the loop most projects converge on; the details are the user's.

## Adapting them

Every project-specific value is a `<<PLACEHOLDER>>` token. Replace all of them, then grep for `<<` to prove none survived — a leftover placeholder is a command that will send an agent to a folder that doesn't exist.

| Placeholder | Is | Example |
| --- | --- | --- |
| `<<WIKI>>` | vault root, as reachable **from the repo root** | `docs/wiki` or `C:\Users\me\Vaults\Acme` |
| `<<TICKETS>>` | ticket folder, vault-relative | `05_Requirements/Tickets` |
| `<<TEMPLATES>>` | template folder, vault-relative | `00_Start-Here/Templates` |
| `<<RELEASES>>` | release-notes folder | `08_Delivery-and-QA/Releases` |
| `<<MEETINGS>>` | meeting-notes folder | `09_Meetings` |
| `<<DECISIONS>>` | ADR folder | `07_Engineering/Decisions` |
| `<<SOURCES>>` | raw immutable artifacts (transcripts, exports) | `01_Sources` |
| `<<TRACKER>>` | one clause naming the tracker and how to reach it | `the Asana project 1211968284799304 via the Asana MCP` — or `none` |
| `<<CHAT>>` | one clause naming the team channel and how to reach it | `#development in Slack via the Slack MCP` — or `none` |
| `<<GATES>>` | the verification commands, in order | `npm run typecheck && npm run lint && npm test` |
| `<<ID_SCHEME>>` | ticket id prefixes and width | `US story / BUG bug / SEC security, 5 digits (US00042)` |
| `<<S_NEW>>` | status a new ticket starts in | `Ready for Refinement` |
| `<<S_REFINEMENT>>` | refinement in progress | `Refinement` |
| `<<S_READY_DEV>>` | refined, buildable | `Ready for Dev` |
| `<<S_DEV>>` | being implemented | `Development` |
| `<<S_REVIEW>>` | code-complete, awaiting manual review | `Ready for Review` |
| `<<S_DONE>>` | shipped | `Deployed` |

**If there is no tracker or no chat**, replace `<<TRACKER>>`/`<<CHAT>>` with `none` and delete the steps that use them — don't leave an instruction the agent can't satisfy. The wiki is then the only system, which is simpler, not worse.

## What's here

| Command | Chip | Does |
| --- | --- | --- |
| `/create-ticket <desc>` | block chip in reports/meeting notes | duplicate check → spec from template (+ tracker task) |
| `/refine <id>` | ticket card | read spec + context, work open questions to 0, → `<<S_READY_DEV>>` |
| `/update-ticket <id>` | ticket card | fold feedback (comments, thread, tracker, code drift) into the spec |
| `/implementation-plan <id>` | ticket card | plan stored in the ticket, durable decisions extracted as ADRs |
| `/develop <id>` | ticket card | preconditions → implement with tests → gates green |
| `/test-plan <id>` | ticket card | manual-only checklist, `open_tests`, **freeze**, → `<<S_REVIEW>>` |
| `/release [version]` | manual | test pass → bump → release note from the board → tag → promote → announce |
| `/meeting agenda\|report <date> <title>` | meeting + calendar chips | agenda from the board; transcript → report with decisions folded into tickets |

Deliberately **not** included, because they depend on infrastructure no starter set can guess: `/promote <env>` (deployment topology), `/daily-routine` and `/weekly-maintenance` (their rulebooks live in the wiki), `/sync-wiki` (only if the vault is in git). All four are described in `docs/skills.md`. `/fix-bug` is `/create-ticket` with `type: bug` followed by the normal loop — add it as a wrapper if bug intake is frequent.

## What belongs in `CLAUDE.md`, not here

Invariants every command inherits — the [freeze rule](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md#the-freeze-rule), the precedence order, wiki-vs-tracker source of truth, and "no command moves a ticket across a gated boundary on its own". A rule copied into eight commands holds in six. These files reference those invariants; they don't restate them.

## Conventions the commands assume

- **`<!-- GUIDE: … -->`** in a template is scaffolding — strip it from any section you fill, leave it on sections you don't.
- **`%% … %%`** in a ticket is a *human's* inline comment — feedback for `/update-ticket` to fold in and then delete. Never use it for machine scaffolding, or the two become indistinguishable.
- **Counters are gates.** `open_questions: 0` leaves refinement; `open_tests: 0` leaves review. Both are frontmatter, so the gate is a badge on the card rather than a memory.
- **A command that can't proceed stops and says why**, with the status left where a human will see it. Plowing through an ambiguous ticket produces work someone has to unpick.
