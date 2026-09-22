# Starter workflow commands

A generic, adaptable implementation of the catalog in [`docs/skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md). Copy these into the **code repository** as `dispatch/workflow/*.md` — never into the wiki (see the wiki=state / repo=process boundary in that doc) — then replace every `<<PLACEHOLDER>>`.

Each agent gets a **stub** beside them rather than a copy: `.claude/commands/<name>.md` and `.codex/skills/<name>/SKILL.md`, each carrying only its own frontmatter and a pointer to `dispatch/workflow/<name>.md`. One body, one process, however many agents.

These are working defaults with an adaptation contract: change project vocabulary while preserving durable note artifacts, their review surfaces, human gate ownership, honest counters, freeze/correction-by-annotation, personal ownership, registered maintenance and declared precedence. Put the shared rules once in `dispatch/invariants.md` and point each agent at it. The explicit small-bug shortcut below is the bounded exception, not a general review toggle.

## Adapting them

Every project-specific value is a `<<PLACEHOLDER>>` token. Replace all of them, then grep for `<<` to prove none survived — a leftover placeholder is a command that will send an agent to a folder that doesn't exist.

| Placeholder | Is | Example |
| --- | --- | --- |
| `<<WIKI>>` | vault root, as reachable **from the repo root** | `wiki` (relative path or git-ignored symlink), or a temporary absolute vault path |
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
| `<<S_READY_DEV>>` | optional ready queue, entered only with human authorization | `Ready for Dev` |
| `<<S_DEV>>` | being implemented | `Development` |
| `<<S_REVIEW>>` | code-complete, awaiting manual review | `Ready for Review` |
| `<<S_DONE>>` | completion status, also used by the small-bug shortcut | `Done` |
| `<<S_RELEASED>>` | shipped in a release — archival, excluded from progress, and the only status `/release` promotes to | `Released` |
| `<<P_COMPLETED>>` | completion-date property; must match `milestones.completedProperty` and the drag automation | `completed` |

**If there is no tracker or no chat**, substitute `none`. Every workflow explicitly skips that integration's lookups, writes and missing-side preconditions while continuing wiki work. Questions go to the requester when chat is absent. A configured service being unavailable is a reported failure, not `none`.

**If there is no project-native verification gate**, copy the setup skill's `assets/validate.mjs` to `scripts/dispatch/validate.mjs` and substitute `node scripts/dispatch/validate.mjs` for `<<GATES>>`. That no-argument command is deliberately repository-only. During initial setup, run it once with `--device "<absolute device-config path>" --vault "<absolute vault path>"` to check all three surfaces. Never reference the command unless the file was actually copied and both forms were run successfully.

`<<WIKI>>` is the workflow's vault lookup, not a chip repository path. Prefer repo-relative lookup (including a git-ignored symlink). Absolute paths may temporarily remain in generated workflows until portable project setup is implemented (US00033 in Dispatch); they need adaptation on another machine. Never write them into notes, shared settings or chip repo fields. This repository continues using `wiki`.

**Statuses describe transition roles, not every board column.** `refine` and `implementation-plan` leave the card in refinement. A human can authorize the ready queue or invoke development directly; a queue name is not permission. Example mappings:

| Role | Solo | Queued delivery |
| --- | --- | --- |
| `<<S_NEW>>` | Backlog | Intake |
| `<<S_REFINEMENT>>` | Refinement | Refinement |
| `<<S_READY_DEV>>` | Refinement | Ready for development |
| `<<S_DEV>>` | In progress | Development |
| `<<S_REVIEW>>` | Review | Review |
| `<<S_DONE>>` | Done | Done |
| `<<S_RELEASED>>` | Released | Shipped |

The queued board can additionally contain `Awaiting build` and `Ready for delivery`, entered by the team's humans or automations. No extra workflow token is needed; configure their order, progress and actors in the board. Do not describe a delivery queue as completed just to reuse `S_DONE`. `<<S_DONE>>` and `<<S_RELEASED>>` are two claims, not one: completion is the team's, a release is the product's. Keep the completion automation and the progress weight on `<<S_DONE>>`, so the forecast measures throughput rather than release cadence, and exclude `<<S_RELEASED>>` from progress. If the project genuinely ships on completion, map both tokens to the same column and say so — do not drop the distinction silently.

### Never substitute a person

Notice that **no placeholder is a name.** That is deliberate: commands encode *process*, the vault encodes *who*. Write "the ticket's `assignee`", "the requester", "whoever launched this chip" and let it resolve at runtime from:

| Source | Answers |
| --- | --- |
| `assignee:` frontmatter (the board's `assigneeProperty`) | who is doing *this ticket* |
| `owner:` → the team folder | who is accountable for *this page* |
| `todos.assignees` in `data.json` | the known people attribution matches against |

A name hardcoded in prose merely goes stale when someone joins or leaves. A name hardcoded in **generated content** does damage: the Todos tab attributes `- [ ] **Name:**` items by that prefix, so a fixed name in `/test-plan` books the whole team's manual checks to one person. And even on a one-person project the command cannot know who clicked the chip — "the assignee" is the more accurate phrase from day one.

## What's here

<!-- shipped-workflows:start -->

| File | Invocation argument | Reads | Writes / review surface | Exit and authority |
| --- | --- | --- | --- | --- |
| `create-ticket.md` | `description + source` | source, templates, existing tickets | ticket + tracker task; index/log | Intake is ungated; starts in the new-ticket column |
| `refine.md` | `id` | spec, links, code, discussion | answers and criteria in the ticket; open_questions | Human ends refinement; card stays put |
| `update-ticket.md` | `id` | inline feedback, thread, tracker, code drift | updated spec and recounted counters | No status move; respects frozen contracts |
| `implementation-plan.md` | `id` | refreshed spec, code, binding ADRs | plan in the ticket; ADRs after sign-off | Human signs off; card stays put |
| `develop.md` | `id` | approved plan and criteria | code/tests; as-built notes; invalidated counts cleared | Explicit invocation + preconditions enter development; fresh reviewer next |
| `code-review.md` | `id` | ticket, diff, current build, tests | dated findings in the ticket; open_findings | Independent session; blocking findings prevent test-plan |
| `test-plan.md` | `id` | code-complete ticket, green gates, clean review | manual checks; open_tests; frozen contract | Enters review after verified preconditions; human completes remaining checks |
| `fix-bug.md` | `report` | report, duplicates, affected code | bug ticket, small fix, actual verification and completion record | Explicit shortcut only; stops when full workflow or a human check is needed |
| `release.md` | `version` | version scope, verified tickets, project release policy | release note, version/build; released tickets + tracker | Explicit release request and readiness gates; publishing follows project policy |
| `meeting.md` | `agenda or report` | board, or transcript and discussion | meeting note; decisions folded into tickets | Agenda before; report requires transcript; no invented decisions |

<!-- shipped-workflows:end -->

Optional, **not shipped**: `/daily-routine` and `/weekly-maintenance` need project rulebooks; `/sync-wiki` applies only to a git-backed vault. See `docs/skills.md` for examples.

**`fix-bug` is an explicit shortcut**, not a wrapper around five separate commands. Create the ticket before code, verify the small fix, record the result and omitted independent review, and leave `open_findings` empty. Finish only with no outstanding questions/manual checks and a known version target; stamp freeze/completion and mirror the tracker. Stop and warn when scope grows or verification needs a human. It does not invoke release, merge or publish.

## What belongs in `dispatch/invariants.md`

Invariants every command inherits — the [freeze rule](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md#the-freeze-rule), the precedence order, wiki-vs-tracker source of truth, and "no command moves a ticket across a gated boundary on its own". A rule copied into eight commands holds in six. These files reference those invariants; they don't restate them.

## Conventions the commands assume

- **`<!-- GUIDE: … -->`** in a template is scaffolding — strip it from any section you fill, leave it on sections you don't.
- **`%% … %%`** in a ticket is a *human's* inline comment — feedback for `/update-ticket` to fold in and then delete. Never use it for machine scaffolding, or the two become indistinguishable.
- **Counters are gates.** `open_questions: 0` leaves refinement; `open_findings: 0` *enters* review (the code review runs before the freeze); `open_tests: 0` leaves it. All three are frontmatter, so the gate is a badge on the card rather than a memory. A counter describes the current build: the latest writer overwrites, unset is not 0, and a command that invalidates a count clears it rather than writing 0. A `0` is a recorded count, never a default — the section it counts has to show the count, including an explicit "none, because …".
- **A command that can't proceed stops and says why**, with the status left where a human will see it. Plowing through an ambiguous ticket produces work someone has to unpick.

## Updating an existing setup

Review a diff against the new starter and merge the intended behavioral changes into the project's canonical files. Do not overwrite adaptations. Update the shared invariants and stubs consistently, then check the invocation and resulting artifacts for each configured agent.
