# Workflow skills

Dispatch ships **ten starter workflows through the `dispatch-setup` agent plugin**.
They are working defaults to adapt to your project. The Obsidian plugin renders the
board and launches chips; it does not bundle or execute a fixed development process.

## Install and adapt

Install `dispatch-setup` using the [setup instructions](installation.md), then invoke
it in your code repository. It interviews you about the vault, lifecycle, tracker,
chat and coding agents and scaffolds the workflows alongside your code. Existing
projects should compare and merge updated starters into their adapted files; setup
must not overwrite an established workflow without reviewing that change with you.

Three different artifacts make this work:

| Artifact | Location | Purpose |
| --- | --- | --- |
| Templated starter | `plugins/dispatch-setup/skills/dispatch-setup/assets/commands/` | Seed shipped with setup; project values are substituted at installation |
| Project's canonical workflow | `dispatch/workflow/<name>.md` | One instruction body per workflow, versioned with that project's code |
| Agent invocation stub | `.claude/commands/<name>.md` or `.codex/skills/<name>/SKILL.md` | Agent-specific metadata and argument hand-off; points to the canonical body, carries no steps |

The starter and an existing project's adapted workflow need not be byte-identical.
Claude invokes `/refine US00042`; Codex invokes `$refine US00042`. Both read the same
canonical body with the supplied argument. Wiki = state, repo = process, chips = the
bridge. A note names a tool and repository alias; device settings resolve commands
and paths.

## Shipped workflows

Each filename below is present in the starter directory. Invoke its name without
`.md`, using your agent's prefix. `meeting` has two modes, not two files.

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
| `release.md` | `version` | version scope, verified tickets, project release policy | release note, version/build; completed tickets + tracker | Explicit release request and readiness gates; publishing follows project policy |
| `meeting.md` | `agenda or report` | board, or transcript and discussion | meeting note; decisions folded into tickets | Agenda before; report requires transcript; no invented decisions |

<!-- shipped-workflows:end -->

## The adaptation contract

Change folder and property names, columns, IDs, tracker/chat providers, chip labels
and local commands to match your project. Keep these parts of the method:

- A workflow produces a durable artifact in the note; that artifact is the review surface.
- Human decisions are not manufactured by the skill that wrote the artifact. A human
  drag or explicit next-step invocation supplies approval; mechanical gates must actually run.
- Counters describe the current build. Empty means uncounted; zero means counted and
  clear. Recounts replace earlier counts, and code changes invalidate review counts.
- The contract freezes when work leaves development. Later corrections are annotations,
  and new scope gets a linked ticket. See [page types](page-types.md#the-freeze-rule).
- Every page has an accountable person. Derived pages register their maintenance.
  The project declares precedence and which system wins a wiki/tracker disagreement.

Put these rules once in `dispatch/invariants.md`; `CLAUDE.md` and `AGENTS.md` point
there. Ordinary development still requires independent code review before the test
plan and freeze. A general review-toggle feature is not part of these starters.

The setup README documents substitution tokens. `S_*` tokens describe statuses a
workflow may write with the required authorization; they do not enumerate every
column on your board. A solo board can use the same value for refinement and the
optional ready queue. A queued-delivery board can add human/automation-only columns
without inventing workflow tokens or granting a skill permission to advance there.

For vault lookup, prefer a repo-relative path, including a git-ignored symlink to an
external vault. Setup temporarily permits an absolute vault path in generated
workflow files; it will need adaptation on another machine until portable project
setup is implemented. This allowance never applies to notes, shared settings, or
chip repository fields, which still use aliases. It does not move the device config
into the repository or vault.

## Small-bug shortcut

Explicitly invoke `/fix-bug <report>` (or `$fix-bug <report>`) for a small bug with a
small blast radius, such as wording or layout, usually fixed in one file. Before
changing code it asks whether the full workflow is worthwhile. If so, it creates the
bug record, leaves it for refinement and warns you instead of starting a larger fix.

For a suitable bug, it creates the ticket and tracker mirror first, fixes and verifies
it, records the result and remaining checks, then finalizes/freezes the contract,
stamps completion and mirrors the tracker. It can reach Done in one invocation.
The record states that independent review was omitted; `open_findings` stays empty,
never a fabricated zero. No unresolved question, failed gate, or outstanding manual
check may remain. A layout fix needing your visual judgment stays open.

The ticket must carry its known target version so release notes can include it. The
shortcut does not merge, tag or publish. A tracker failure leaves a visible partial
synchronization record; retry reconciles the existing issue rather than creating a
duplicate. A completed ticket's original completion date survives later release runs.

## Releases and meetings

Release takes its scope from ticket target versions, including completed shortcut
fixes, and checks recorded verification before writing the release note. The project's
release policy defines building/tagging/publishing; in Dispatch itself a tag builds
a draft and a human publishes it. A workflow writing status directly also writes the
completion date and tracker state: board drag automations do not fire for that write.

`meeting agenda` builds decisions to discuss from the board. `meeting report` requires
the transcript and folds actual decisions into tickets before reporting back. Frozen
contracts get dated record entries, not rewrites. With no tracker or chat configured,
work stays in the wiki and questions go to the requester; an unavailable configured
service is reported as a failure rather than silently treated as absent.

## Optional examples — not shipped

These examples require project-specific infrastructure and rulebooks. They are not part of the starter inventory above.

| Skill | Cadence | Does |
| --- | --- | --- |
| `/daily-routine` | daily | folds new feedback into tickets in refinement, recounts open tests, reconciles wiki ↔ tracker both ways, posts one short update ranked by what blocks the next release |
| `/weekly-maintenance` | weekly | backend/schema drift check, doc-sync jobs (schema, sitemap, API catalog…), tracker sync, the report suite, industry scan — one summary post |
| `/sync-wiki` | on demand / around every skill | pull, commit, push the vault; resolve conflicts by reading both sides (only if the wiki is in git — see [wiki-structure.md](wiki-structure.md#where-the-wiki-lives-relative-to-the-code)) |

What makes recurring jobs survive contact with reality:

- **Sync-and-surface, never decide.** A daily job may not answer an open question, may not move a ticket across a gated boundary, and stays silent when nothing changed. A job that posts every day gets muted in a week.
- **Rulebooks live in the wiki** (`02_Product/Reports/_definitions/`), one page per job: what it measures, what counts, how it ranks. The skill executes; the rulebook decides. Tuning a threshold becomes a wiki edit anyone can review — not a code change.
- **A failing job is reported, never silently skipped.** The one week the drift check quietly failed is the week the drift happened.
- **Derived documents register their refresh.** Any job generating a page sets `maintained_by` on it; a job that no longer exists becomes a finding on the next run. This is the enforcement half of the [maintenance contract](page-types.md#derived-pages).

## Wiring skills to chips

Define each skill once as a chip template in settings — `label | tool | repo | prompt` — and every ticket card offers it in its right-click menu:

```
Refine              | claude | my-project | /refine {{id}}
Update ticket       | claude | my-project | /update-ticket {{id}}
Implementation plan | claude | my-project | /implementation-plan {{id}}
Start development   | claude | my-project | /develop {{id}}
Code review         | claude | my-project | /code-review {{id}}
Write test plan     | claude | my-project | /test-plan {{id}}
```

A label may carry the chip's **intent** — `Refine #refine` — which is what per-tool prompts are keyed on. It is worth setting only if you use those overrides, and it exists so that renaming the button does not silently drop them.

**One chip per action, however many agents you run.** The `tool` column is a *default*, not a constraint: with more than one agent configured, clicking a chip offers one button per agent and shows the exact command each would run. And you do not write a second prompt per agent — set the tool's invocation prefix once in the device config (`codex = $`), and a prompt that starts with `/` is rewritten for that agent. A prompt that is not a command — the batch ones below — is never touched.

Column headers get batch versions (`{{ids}}`, `{{status}}`, `{{count}}`) for "update all tickets in refinement"; meeting rows and calendar events get their own sets. The mechanics — variables, tool commands, the busy-gate, run tracking — are in [installation.md](installation.md#chips).

Repositories are referenced by **alias**, never by path, so the same chip works on every teammate's machine.
