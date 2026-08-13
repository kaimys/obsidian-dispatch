# Workflow skills

A chip on a card carries one line: `/refine US00042`. Everything behind that line — what to read, whom to ask, what to write, when to stop — is a **skill**, and skills live in the **code repository** (`.claude/commands/*.md`), not in the wiki.

That boundary is the whole design:

- **Wiki = state.** What is true, what is decided, what is still open.
- **Code repo = process.** How state changes.
- **Chips = the bridge.** One line, launched from the card, executed in the repo.

Keeping process in the repo means it versions with the code, travels through git to every teammate, and is reviewed like code. Keeping it out of the wiki means a note can never define what an agent does — which is also what makes chips safe to click (see [installation.md](installation.md#security-model)).

**Invariants are not skills.** Rules like the ticket [freeze](page-types.md#the-freeze-rule), the precedence order, or "never move a ticket across a gated boundary without the gate being met" belong in `CLAUDE.md`, where every skill inherits them. A rule copied into six skills holds in four.

Dispatch ships none of these skills. What follows is a catalog to adapt — the shape that a project of moderate size converges on.

## Skills for the ticket workflow

The core loop. Each one is wired to a chip on the ticket card, so the board is the launcher.

| Skill | Reads | Writes | Typically needs |
| --- | --- | --- | --- |
| `/create-ticket <description>` | templates, existing tickets (duplicate check) | new ticket **and** tracker task, `index.md`, `log.md` | tracker MCP |
| `/refine <id>` | the spec, linked context, domain guardrails, ADRs | open questions into the team thread, answers back into the spec, `open_questions` | chat MCP (Slack/Teams), tracker MCP |
| `/update-ticket <id>` | inline note comments, the ticket's threads, tracker comments | folds feedback into the spec, recounts counters | chat MCP, tracker MCP |
| `/implementation-plan <id>` | the refined spec, engineering docs, existing ADRs | the plan into the ticket, **new ADRs** for durable decisions | — |
| `/develop <id>` | the plan, the code | code + tests, status moves, `log.md` | — |
| `/test-plan <id>` | the ticket, the automated suites | the manual plan (only what automation doesn't cover), `open_tests` | — |
| `/fix-bug <report>` | a bug report, a thread, or a description | a bug ticket in both systems, then the fix through the same loop | chat MCP, tracker MCP |

Three things make this loop hold together:

- **Counters are gates, not decoration.** `open_questions: 0` is what lets a ticket leave refinement; `open_tests: 0` is what lets it leave review. Because they're frontmatter, the gate is visible on the board as a badge instead of living in someone's head.
- **The team answers where it already talks.** Refinement posts questions into the team chat and reads the replies back — nobody is asked to review a spec in a tool they don't open. The thread URL goes in `discussion:` so the conversation stays findable from the card.
- **A skill knows when to stop.** Root cause unclear, needs a product decision, touches safety-critical copy → hand back with the status set to whatever means "needs a human", and say why. An agent that plows through an ambiguous ticket produces work someone has to unpick.

Every status move updates **both** the wiki frontmatter and the tracker. Decide once which side wins when they disagree (the wiki, if the board is where people actually work) and write it in `CLAUDE.md`.

## Skills for releases

| Skill | Does |
| --- | --- |
| `/release [version]` | full test pass → version bump → release note from the tickets in the target version → build → tag → promote every *Ready for Build* ticket to *Ready for Review* → announce |
| `/promote <env>` | move backend/infrastructure changes from the development environment to production, as its own reviewable step |

Two properties of a release skill matter more than the steps:

- **The order is load-bearing, so write down why.** Prove the candidate on a test environment *before* touching production; refresh any backend mirror *before* promoting it; build production *after* the promotion, because that build talks to the promoted backend. A step order without reasons gets "optimized" by the next person.
- **The release note is generated from the board**, not written from memory. Every ticket carrying the target version is in scope; anything shipped without a ticket is invisible to the note — which is a good reason for the no-ticket-no-merge rule.

Release notes then feed the Release Plan tab back: a shipped version shows its date and links its note instead of a forecast.

## Skills for meetings

One skill with two modes, both wired to chips on the Meetings tab.

| Mode | Before / after | Does |
| --- | --- | --- |
| `/meeting agenda` | before | builds the agenda from the board — open refinement questions, tests awaiting sign-off, what blocks the next release — writes the meeting note, announces it in the team thread and stores that URL in `discussion:` |
| `/meeting report` | after | reads the transcript from `01_Sources/` **together with** the discussion thread, appends summary / decisions / action items with ticket IDs, folds decisions into the affected tickets, stamps `decisions_folded:`, posts a short summary |

The step people skip is **folding decisions into the tickets**. A decision that lives only in a meeting note has to be rediscovered by whoever next opens the ticket — and won't be. Fold first, summarize second; on a frozen ticket, append to the record zone rather than editing the contract.

Action items land in an allowlisted section with owners, which is what the Todos tab collects.

## Skills for recurring work

These are the ones that keep the wiki honest. Nobody does this bookkeeping by hand for long.

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
Write test plan     | claude | my-project | /test-plan {{id}}
```

Column headers get batch versions (`{{ids}}`, `{{status}}`, `{{count}}`) for "update all tickets in refinement"; meeting rows and calendar events get their own sets. The mechanics — variables, tool commands, the busy-gate, run tracking — are in [installation.md](installation.md#chips).

Repositories are referenced by **alias**, never by path, so the same chip works on every teammate's machine.
