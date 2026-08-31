# Wiki structure

Dispatch is a board over a wiki. This page describes the wiki it was built against — generalized, so you can copy it into a new project and adapt the names.

It follows [Karpathy's LLM wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) with one addition: the wiki is also the ticket tracker, because that is what Dispatch turns it into.

Nothing here is enforced by the plugin. Dispatch needs folder paths and property names; the structure is what makes those useful to humans and agents at the same time. Treat the tree below as a starting point for a conversation, not a standard — every project ends up with its own.

## The three layers

| Layer       | Lives in                                       | Written by                 | Rule                                                                           |
| ----------- | ---------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| **Sources** | `01_Sources/`                                  | humans (drop files in)     | **Immutable.** Agents read them, never modify them.                            |
| **Wiki**    | everything else                                | agents, reviewed by humans | Interpretations of sources plus the project's own decisions. Rewritten freely. |
| **Schema**  | `CLAUDE.md` in the code repo, `00_Start-Here/` | humans                     | How the wiki is structured, what is authoritative, which rules are inviolable. |

> "Your curated collection of source documents. Articles, papers, images, data files. These are immutable — the LLM reads from them but never modifies them. This is your source of truth." — Karpathy

The separation is what makes the wiki safe to rewrite. A wiki page is an *interpretation* — of a transcript, a bug report, a regulation — and interpretations get corrected. If the artifact behind it was edited into the page and then discarded, nobody can re-derive it. Keep the artifact.

The **schema layer** is the part most projects forget. Conventions that every workflow must respect — what is authoritative, which sections may never be rewritten, who owns what — belong in `CLAUDE.md`, not in the individual skills. A rule copied into six skills is a rule that will hold in four of them.

## The example tree

```
00_Start-Here/     index.md · log.md · Home.md · Glossary.md · Writing Standards.md
  Templates/       one template per page type, with inline guidance
  Team/            one page per member: contact, responsibilities, working hours
01_Sources/        raw, immutable — see below
  Meeting Transcripts/
02_Product/        vision · scope definition · success metrics
  Reports/         dated, recurring analyses (scope gaps, doc↔code drift, market news)
    _definitions/  the rulebooks those reports are generated from
03_Legal/          the documents that bind you and the constraints you work under
                   (rename per project: Clinical, Safety, Regulatory, Editorial …)
04_Discovery/      research, product ideas, evaluations, benchmarks — and anything
                   not yet sorted
05_Requirements/
  Tickets/         ← one note per ticket. This is the Dispatch board.
    images/        screenshots referenced by bug tickets
  Non-Functional/  NFR - Privacy.md · NFR - Performance.md · NFR - Accessibility.md
06_UX/             design guidelines, design system, screen specs
07_Engineering/    System Context.md
  Decisions.md     index of ADRs
  Decisions/       ADR-0001 - <decision>.md …
  Frontend/        kept in sync with the code — changes often
  Backend/         kept in sync with the code — changes often
08_Delivery-and-QA/
  Releases/        Release - v1.2.0 - <name>.md  ← feeds the Release Plan tab
09_Meetings/       YYYY-MM-DD - <meeting>.md      ← feeds the Meetings tab
10_Archive/        retired material, kept out of the agent's way
```

Numbers are sort keys, not law. Rename and merge freely — but **don't renumber a live vault** to close a gap: links, muscle memory and half the team's bookmarks break. A hole where a folder used to be is cheaper than the churn.

## What each folder is for

| Folder | Holds | Who writes it | What reads it |
| --- | --- | --- | --- |
| `00_Start-Here/` | The entry point: `index.md`, `log.md`, glossary, conventions, the workflow doc | agent (index/log), humans (conventions) | every agent session; new team members |
| `00_Start-Here/Team/` | One page per person — contact, responsibilities, working hours | humans | owner attribution, who to ask, when to expect an answer |
| `00_Start-Here/Templates/` | The shape of every page type, with inline guidance on who fills which section and when | humans | the skills that create pages |
| `01_Sources/` | Raw artifacts, unmodified | humans drop them in | the ingest step of every workflow |
| `02_Product/` | Why the product exists, what is in scope, how success is measured | humans, agent-assisted | refinement, planning |
| `02_Product/Reports/` | Dated snapshots: scope gaps, doc↔code inconsistencies, market news | agent (recurring jobs) | the team; the next run compares against the last |
| `02_Product/Reports/_definitions/` | One page per recurring report: what it measures, what counts, how it ranks | humans | the maintenance skill that runs the job |
| `03_Legal/` | Published commitments (privacy declaration, terms), the constraints you work under, generated license inventories — see [page types](page-types.md#legal-and-domain-documents) | product + counsel, agent for the generated ones | every ticket that touches them |
| `04_Discovery/` | Research and evaluation that isn't a decision yet — plus the unsorted pile | humans + agent | product planning |
| `05_Requirements/Tickets/` | **The tickets.** One note = one story, bug or task: full spec + frontmatter | agent (from intake) + humans | **the Dispatch board**, every workflow skill |
| `05_Requirements/Non-Functional/` | Cross-cutting requirements no single ticket owns | humans, agent-assisted | planning, review |
| `06_UX/` | Design system, guidelines, screen specs | designers + agent | implementation, visual review |
| `07_Engineering/` | How the system is actually built: context, ADRs, schema, interfaces | agent (kept in sync from code) | implementation, onboarding |
| `07_Engineering/Decisions/` | **ADRs** — one per durable decision, including the deliberate *we do not do X* | agent (extracted from tickets), humans decide | anything designing in that area |
| `08_Delivery-and-QA/Releases/` | One note per release: version, date, scope | agent (at release) | **Release Plan tab** |
| `09_Meetings/` | One note per meeting: participants, decisions, action items | agent (from transcript) | **Meetings + Todos tabs** |
| `10_Archive/` | Retired, superseded, historical | agent (on retirement) | rarely — deliberately |

## `01_Sources/` — the immutable layer

Everything the wiki is derived from, in its original form:

```
01_Sources/
  Meeting Transcripts/   2026-08-04 - Product Weekly - NoteTaker.md
  Feedback/              2026-07-19 - Beta tester - chat issues.md
  Research/              2026-06-30 - <vendor> pricing page.html
  Domain/                regulations, guidelines, standards, counsel's standard
                         drafts and signed finals (PDF is fine)
  Exports/               analytics dumps, CSVs, tracker exports
  Assets/                screenshots and recordings referenced by reports
```

The rules that make it worth having:

1. **Never edited, never summarized in place.** An agent reads a source and writes a *new* page. If the interpretation was wrong, the source is still there to redo it. This is the entire point.
2. **Never deleted.** Retire by moving to `10_Archive/`, not by shrinking the folder.
3. **Filename is `YYYY-MM-DD - <origin> - <title>.<ext>`.** The date is when the artifact was produced, not when you filed it — so sorting by name sorts by history.
4. **Every ingest gets a `log.md` entry** naming the source file *and* the pages it changed. That line is how anyone later answers "where did this claim come from?".
5. **Derived pages cite their source** by link. A claim with no source and no decision behind it is a claim nobody can check.
6. **Binaries belong here and nowhere else.** PDFs, HTML dumps, screenshots, recordings, CSVs. Keeping them out of the wiki layer is what keeps the wiki greppable and cheap for an agent to read end to end.
7. **Only humans add to it.** An agent writing its own output back into sources would launder its interpretation into evidence.

## `index.md` and `log.md`

Two pages in `00_Start-Here/` carry the pattern's bookkeeping. They are the reason an agent can find anything without scanning the vault.

**`index.md` — the catalog.** Every page, grouped by folder, with a one-line summary and its status. Read first in any session. Updated in the same step as the page it describes, never in a separate cleanup pass — that pass never happens.

| Document | Status | Description |
|----------|--------|-------------|
| [[Product Vision]] | approved | One-line summary of what this page says |

**`log.md` — the ledger.** Append-only, newest first, grep-friendly headers:

```markdown
## [YYYY-MM-DD] <type> | <short title>
```

Types: `setup` (structure changed) · `ingest` (a source was processed) · `add` / `edit` / `remove` (pages) · `lint` (contradictions, stale claims, dead links). A few bullets per entry: what changed, which pages, what drove it.

The index answers *what exists*; the log answers *what happened and why*. Agents are good at this bookkeeping and humans are not, which is exactly why the convention can afford to be strict.

## Precedence

Documents will contradict each other. Write the order down once, in `00_Start-Here/`, so nobody re-litigates it per conflict. A reasonable default:

> **External constraints → published commitments → Decisions (ADRs) → Requirements → UX → Engineering → Delivery/QA.**
> Meeting notes, research, inbox items and drafts are never authoritative.

**But the order is a statement about how your team works, not a universal truth**, and it is finer-grained than folder names suggest. Legal is the clearest case: a regulation is imposed on you and outranks every plan, while a privacy declaration or terms of use is *drafted from* the product — counsel supplies a standard document, you say what you actually want, counsel checks whether it's legally available. During that back-and-forth the product leads. Once the text is published and users have agreed to it, it binds the product instead, and a mismatch is the code's problem, not the document's. One folder, two precedence positions, decided by whether the thing has shipped. See [legal and domain documents](page-types.md#legal-and-domain-documents).

Decide your order deliberately, write it down, and revisit it when the team changes.

ADRs sit on top for a reason: they record the decisions that were already argued, including the rejected alternatives. A change that contradicts one is a decision to reopen with the team — not a detail to work around.

## Where the wiki lives relative to the code

The workflow logic lives in the **code repository** as agent skills; the state lives in the **wiki**. How those two sit on disk is a real decision with three viable answers.

### Separate vault, symlinked into the repo

The wiki is its own Obsidian vault, synced by whatever your non-technical colleagues already use (Obsidian Sync, Google Drive, Dropbox), and symlinked into the code repo — a single, git-ignored, repo-relative link (e.g. `wiki`) — so agents and Dispatch see one tree. A script or workflow command that needs the vault names the *link*, never a location: `const VAULT_DIR = "wiki"` in a repo-side script is then true by construction, and moving the wiki costs one repointed link rather than a find-and-replace across every call site.

- **For**: nobody outside engineering ever sees git. Unbounded binary sources cost the repo nothing.
- **Against**: no history, no diffs, no review on the wiki. You cannot ask "what did this spec say when we built it?" — which is exactly the question the [ticket freeze rule](page-types.md#the-freeze-rule) exists to answer, and it answers it by convention instead of by version control.

Two failure modes are silent, so watch for both:

- **Device-local config is keyed on the vault's absolute path.** Moving or renaming the vault orphans it — the board renders and looks healthy, and every chip fails on click.
- **Vault-relative folder paths in the *shared* config are still folder paths.** A restructure that changes them without updating the shared settings leaves the board empty rather than erroring.

### Monorepo — wiki and code in one repository

```
repo/
  wiki/           the vault
  backend/
  frontend/
  shared/
  .claude/        skills + scripts shared across all of it
```

Skills at the repo root are available anywhere you launch from it; directory-scoped ones resolve to the nearest match; nested `CLAUDE.md` files layer root conventions with per-package specifics. That part works well and is the strongest argument for the layout.

Two things to plan for:

- **Dispatch's busy-gate is per repo alias**, so one monorepo means one agent at a time across backend *and* frontend. Define one alias per package (pointing at subdirectories) if you want parallel sessions, or use worktrees.
- **`01_Sources/` is unbounded and mostly binary.** In git that means LFS, or keeping sources out of the repo.

And the real obstacle: the wiki is now in git, and the people who write most of it may not use git.

### Making git invisible to non-technical people

Three options, roughly in order of how well they hold up:

- **The agent is the git client.** Wiki sync becomes a step in the workflows that already run — pull before reading, commit and push after writing, resolve conflicts by reading both sides rather than by picking a hunk. An agent is a genuinely better merge tool than a merge tool, because it can tell which of two edits is the newer decision. Worth a dedicated skill (`/sync-wiki`) and a call at the start and end of every skill that touches the vault.
- **The Obsidian Git plugin**, auto commit-and-sync on a short interval with pull on launch. Nobody sees a commit. Conflict markers inside a note are the failure mode; short intervals and one owner per page keep it rare.
- **A desktop client** (GitHub Desktop). Visible, but simple — still relies on people remembering to pull.

The first two compose: the agent handles the sessions where it does the writing, the plugin covers the hours where a human is typing in Obsidian.

## Starting small

The full tree is what a project looks like after a year. On day one, four folders carry it:

```
00_Start-Here/           index.md · log.md · Templates/
01_Sources/              everything raw
05_Requirements/Tickets/ the board
07_Engineering/Decisions/ the decisions you'll otherwise re-argue
```

Add a folder when a page doesn't fit anywhere — not before. An empty `06_UX/` teaches an agent nothing; fifteen real tickets teach it your entire vocabulary.
