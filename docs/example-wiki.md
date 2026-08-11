# Example wiki structure

Dispatch is a board over a wiki. This is the wiki it was built against — generalized, so you can copy it into a new project and adapt the names.

It follows [Karpathy's LLM wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): humans curate **raw sources**, the agent maintains the **wiki**, and a **schema** file tells it how. Everything below is that pattern with one addition — the wiki is also a *ticket tracker*, because that is what Dispatch turns it into.

Nothing here is enforced by the plugin. Dispatch only needs folders and frontmatter property names; the structure is what makes those useful to humans and agents at the same time.

## The three layers

| Layer | Lives in | Written by | Rule |
| --- | --- | --- | --- |
| **Raw sources** | `10_Sources/` | humans (drop files in) | **Immutable.** Agents read, never edit, never delete. |
| **Wiki** | `00_`–`09_`, `11_`, `12_` | agents, reviewed by humans | Interpretations of sources + the project's own decisions. Rewritten freely. |
| **Schema** | `CLAUDE.md` in the code repo, `09_Templates/`, `00_Start-Here/Writing Standards.md` | humans | How the wiki is structured, what is authoritative, which workflow runs when. |

The separation is what makes the wiki safe to rewrite. A wiki page is an *interpretation* — of a transcript, a bug report, a regulation — and interpretations get corrected. If the artifact behind it was edited into the page and then thrown away, nobody can re-derive it. Keep the artifact.

## The tree

```
00_Start-Here/            index.md · log.md · Home.md · Glossary.md
                          Team Roles.md · Writing Standards.md · Development Workflow.md
01_Product/               Product Vision.md · Scope Definition.md · Success Metrics.md
  Reports/                dated point-in-time analyses (gap analysis, inconsistencies, news)
    _definitions/         the rulebooks those reports are generated from
02_Requirements/          
  User-Stories/           ← the ticket folder. One note per ticket. This is the Dispatch board.
  Non-Functional/         NFR - Privacy.md · NFR - Performance.md · NFR - Accessibility.md
  History/                superseded specs, kept for provenance
03_UX/                    Design System.md · design-tool notes
  Screens/                Screen - <Name>.md
04_<Domain>/              the subject matter that constrains the product
                          (Clinical, Legal, Compliance, Editorial, Safety, Pricing …)
05_Engineering/           System Context.md
  Decisions.md            index of ADRs
  Decisions/              ADR-0001 - <decision>.md …
  Frontend/               Sitemap.md · Interfaces.md
  Backend/                Database Schema/ · API catalog · integrations
06_Delivery-and-QA/       Test strategy · testing guide · FAQ
  Releases/               Release - v1.2.0 - <name>.md  ← feeds the Release Plan tab
  Bugreports/             incoming reports (raw ones belong in 10_Sources/)
  Benchmarks/             evaluation runs
07_Meetings/              YYYY-MM-DD - <meeting>.md      ← feeds the Meetings tab
  Agendas/
  Transcripts/            (or symlink/point at 10_Sources/Transcripts/)
08_Discovery/             market, competitor and technology research
09_Templates/             User Story.md · Bug Report.md · ADR.md · Meeting.md · NFR.md
10_Sources/               raw, immutable — see below
11_Inbox/                 unsorted, not yet normalized into the wiki
12_Archive/               retired material, kept out of the agent's way
```

Numbers are sort keys, not law. Rename and merge freely — but **don't renumber a live vault** to close a gap: links, muscle memory and half the team's bookmarks break. Our own vault has a hole at `07` because Decisions moved into `05_Engineering/Decisions/`; the hole is cheaper than the churn.

## What each folder is for

| Folder | Holds | Who writes it | What reads it |
| --- | --- | --- | --- |
| `00_Start-Here/` | The entry point. `index.md`, `log.md`, glossary, roles, conventions, the workflow doc | agent (index/log), humans (conventions) | every agent session; new team members |
| `01_Product/` | Why the product exists, what is in scope, how success is measured | humans, agent-assisted | refinement, gap analysis, planning |
| `01_Product/Reports/` | Dated snapshots: scope gaps, doc↔code inconsistencies, industry news | agent (recurring jobs) | the team; the next report compares against the last |
| `01_Product/Reports/_definitions/` | One note per recurring report: what it measures, what counts, how it is ranked | humans | the maintenance skill that runs the job |
| `02_Requirements/User-Stories/` | **The tickets.** One note = one story/bug/task, full spec + frontmatter | agent (from intake) + humans | **Dispatch board**, every workflow skill |
| `02_Requirements/Non-Functional/` | Cross-cutting requirements that no single ticket owns | humans, agent-assisted | implementation planning, review |
| `03_UX/` | Design system, screen specs, design-tool conventions | designers + agent | implementation, screenshot diffs |
| `04_<Domain>/` | The guardrails your domain imposes — the ones a feature may never quietly cross | domain experts | every ticket that touches them |
| `05_Engineering/` | How the system is actually built: context, ADRs, schema, sitemap, API catalog | agent (kept in sync from code) | implementation, onboarding |
| `05_Engineering/Decisions/` | **ADRs** — one file per durable decision, including the deliberate *we do not do X* | agent (extracted from tickets), humans decide | anything designing in that area |
| `06_Delivery-and-QA/Releases/` | One note per release: date, scope, notes | agent (at release) | **Release Plan tab** (linked release dates) |
| `07_Meetings/` | One note per meeting: participants, decisions, action items | agent (from transcript) | **Meetings + Todos tabs** |
| `08_Discovery/` | Research that isn't a decision yet | humans + agent | product planning |
| `09_Templates/` | The shape of every artifact, with inline guidance | humans | ticket-creating skills |
| `10_Sources/` | Raw artifacts (see below) | humans drop, agents read | ingest steps of every workflow |
| `11_Inbox/` | Anything not yet placed | anyone | triage |
| `12_Archive/` | Retired, superseded, historical | agent (on retirement) | rarely — deliberately |

## `10_Sources/` — the immutable layer

Everything the wiki is *derived from*, in its original form. Suggested split:

```
10_Sources/
  Transcripts/     2026-08-04 - Product Weekly - NoteTaker.md
  Feedback/        2026-07-19 - Beta tester - chat issues.md
  Research/        2026-06-30 - <vendor> pricing page.html
  Domain/          regulations, guidelines, standards (PDF is fine)
  Exports/         analytics dumps, CSVs, tracker exports
  Assets/          screenshots and recordings referenced by reports
```

The rules that make it worth having:

1. **Never edited, never summarized in place.** The agent reads a source and writes a *new* wiki page. If the interpretation was wrong, the source is still there to redo it. This is the whole point.
2. **Never deleted.** Retire by moving to `12_Archive/`, not by shrinking the folder.
3. **Filename is `YYYY-MM-DD - <origin> - <title>.<ext>`.** Date = when the artifact was produced, not when you filed it. Sorting by name then sorts by history.
4. **Every ingest gets a `log.md` entry** of type `ingest`, naming the source file *and* the wiki pages it changed. That line is the audit trail — it is how anyone answers "where did this claim come from?".
5. **Wiki pages cite their source** by link. A claim with no source and no decision behind it is a claim nobody can check.
6. **Binaries belong here, nowhere else.** PDFs, HTML dumps, screenshots, recordings, CSVs. Keeping them out of the wiki layer is what keeps the wiki greppable and cheap for an agent to read end to end.
7. **Only humans add to it.** An agent writing its own output back into sources would launder its interpretation into evidence.

A practical consequence worth planning for: this folder grows without bound and is mostly binary. If the vault syncs through git, that argues for keeping `10_Sources/` out of the repo (or in LFS) while the wiki layer stays plain text.

## `index.md` and `log.md`

Two files in `00_Start-Here/` carry the pattern's bookkeeping. They are the reason an agent can find anything without scanning the vault.

**`index.md` — the catalog.** Every page, grouped by folder, with a one-line summary and its status. Read first in any session. Updated in the same step as the page it describes, never in a separate cleanup pass (that pass never happens).

```markdown
| Document | Status | Description |
|----------|--------|-------------|
| [Product Vision](../01_Product/Product-Vision.md) | approved | One-line summary of what this page says |
```

**`log.md` — the ledger.** Append-only, newest first, grep-friendly headers:

```markdown
## [YYYY-MM-DD] <type> | <short title>
```

Types: `setup` (structure changed) · `ingest` (a raw source was processed) · `add` / `edit` / `remove` (pages) · `lint` (contradiction, stale claim and dead-link cleanup). A few bullets per entry: what changed, which pages, what drove it.

The index answers *what exists*; the log answers *what happened and why*. Agents are good at the bookkeeping and humans are not, which is exactly why it is worth having a convention strict enough for an agent to follow.

## Frontmatter

Two vocabularies. **Documents** carry a review state:

```yaml
---
status: approved          # approved | draft | proposed
source_of_truth: true     # authoritative only when both are set
updated: 2026-08-11
---
```

**Tickets** carry the board. These are the properties Dispatch reads — the names are yours to choose, they are just settings:

| Property | Example | Consumed by |
| --- | --- | --- |
| `id` | `US00042` | card title prefix, chip variable `{{id}}` |
| `type`, `priority` | `story`, `high` | badges, slice-by |
| `status` | `Development` | **Kanban columns** (order = your pipeline) |
| `rank` | `2048` | manual order within a column |
| `version_target` | `v1.4.0` | **Release Plan columns** |
| `size` | `3` | weighted progress + forecast |
| `assignee` | `Kai` | owner badge, slice-by, Todos fallback owner |
| `open_questions` | `2` | `? N` refinement badge — 0 gates the next status |
| `open_tests` | `5` | `✓ N` test badge — 0 means manually reviewed |
| `discussion` | thread URL | chat icon linking to where the team talked |
| `updated`, `deployed` | dates | hygiene; `deployed` drives the velocity forecast |

Two conventions worth stealing: **quote status values** (`status: "Ready for Dev"`) so spaces survive, and keep `id` mandatory — a ticket without one silently drops out of every batch chip that passes `{{ids}}` to an agent.

## Precedence

Documents will contradict each other. Write the order down once, in `00_Start-Here/`, so nobody re-litigates it per conflict:

> **ADRs → Requirements → UX → Domain → Engineering → Delivery/QA.**
> Meeting notes, inbox items, research and drafts are never authoritative.

ADRs sit on top for a reason: they record the decisions that were *already argued*, including the rejected alternatives. A change that contradicts one is a decision to reopen with the team — not a detail to work around. Supersede an ADR by marking it `superseded` and linking the successor; never delete one.

## Where the workflow lives

Not in the wiki. The step-by-step logic — how a ticket is refined, developed, tested, released — belongs in the **code repository** as agent skills (`.claude/commands/*.md`), because it versions with the code, travels through git to every teammate, and is reviewed like code.

The split that makes this work:

- **Wiki** = state. What is true, what is decided, what is open.
- **Code repo** = process. How state changes.
- **Dispatch chips** = the one-line bridge: `/refine {{id}}` on a card in the wiki, executed in the repo.

A typical skill catalog and which folders it touches:

| Skill | Reads | Writes |
| --- | --- | --- |
| `/create-ticket` | `09_Templates/`, `02_Requirements/` (duplicate check) | new ticket, `index.md`, `log.md`, tracker |
| `/refine` | ticket, `04_<Domain>/`, ADRs | ticket spec, `open_questions`, team thread |
| `/implementation-plan` | ticket, `05_Engineering/` | plan in the ticket, **new ADRs** |
| `/develop` | ticket, code | code, status, `log.md` |
| `/test-plan` | ticket, test suites | manual plan, `open_tests` |
| `/release` | tickets by `version_target` | `06_.../Releases/`, status moves |
| `/meeting` | `10_Sources/Transcripts/`, agenda thread | `07_Meetings/` note, decisions folded into tickets |
| `/maintenance` | `01_Product/Reports/_definitions/` | dated reports, sync fixes |

## Starting small

The full tree is what a project looks like after a year. On day one, four folders carry it:

```
00_Start-Here/     index.md · log.md
02_Requirements/User-Stories/     the board
09_Templates/      one ticket template
10_Sources/        everything raw
```

Add a folder when a page doesn't fit anywhere — not before. An empty `03_UX/` teaches an agent nothing; a `02_Requirements/User-Stories/` with fifteen real tickets teaches it your entire vocabulary.
