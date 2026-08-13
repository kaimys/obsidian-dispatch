---
name: dispatch-setup
description: Guided integration of the Dispatch Obsidian plugin into a project — configure the boards (data.json), device-local config, agent chip tools, workflow commands, tracker sync automation and run-lifecycle hooks. Use when the user wants to set up, configure, or connect Dispatch to their vault, repo, tracker or coding agent.
---

# Dispatch setup

You are integrating the **Dispatch** Obsidian plugin (the agentic ticket board) into the user's project. Work interactively: interview → write config → verify. Never invent team conventions — ask, or read them from the user's existing notes.

## 0 · Preflight

1. Locate the **Obsidian vault** and confirm Dispatch is installed (`<vault>/.obsidian/plugins/dispatch/` with `main.js` + `manifest.json`) and enabled (`community-plugins.json`).
   **Not installed? Install it right here** (no need to wait for the community directory):
   - Fetch the latest release assets from `https://github.com/kaimys/obsidian-dispatch/releases/latest` — download `main.js`, `manifest.json`, `styles.css` (e.g. via `curl -L -o <file> https://github.com/kaimys/obsidian-dispatch/releases/latest/download/<file>`).
   - Write them to `<vault>/.obsidian/plugins/dispatch/` (create the folder).
   - Enabling: if `"dispatch"` is missing from `<vault>/.obsidian/community-plugins.json`, append it (create the file as `["dispatch"]` if absent), then have the user restart Obsidian — or simpler, have them toggle **Dispatch** in *Settings → Community plugins* themselves. Requires Restricted mode to be off; that switch is the user's to flip, never flip it for them silently.
   - Alternative if the team prefers a managed updater: [BRAT](https://github.com/TfTHacker/obsidian42-brat) with the repo URL `kaimys/obsidian-dispatch`.
2. Locate the **project repo(s)** the user's tickets refer to, their **issue tracker** (Asana/Jira/Linear/none), and their **agent CLI** (Claude Code, Codex, other).
3. Desktop only: chips and automations spawn local processes — confirm the user runs Obsidian on desktop.

## 1 · Interview (keep it short, confirm with examples from their vault)

- **Wiki already in place? Scan it before asking anything** — turn the interview into a confirmation of pre-filled suggestions instead of cold questions:
  - Find candidate **ticket folders**: folders dense in notes carrying id-like + `status:` frontmatter.
  - Collect the **status vocabulary with counts** (`grep '^status:'` across the candidates) — propose it as the column order, and flag inconsistencies (casing/typo variants would split columns; quoted vs unquoted is harmless).
  - Inventory the **other frontmatter keys and their fill rates** — map what exists to Dispatch's properties (assignee, priority/type → badges, size, version target, discussion URLs) and only propose *new* properties for real gaps.
  - Detect a **releases folder** (notes with `version` + `date` frontmatter or version-numbered names) and a **meetings folder** (date-prefixed note names) for the Milestones/Meetings tabs.
  - Present the result as one proposal ("here's the config I'd write — corrections?") and list any hygiene findings (missing ids, unrendered template stubs) that the ⚠ problems panel will surface after setup.
- **No wiki/vault structure yet?** Offer to scaffold one before anything else — Dispatch works best on top of an agent-friendly wiki (inspiration: [Karpathy's wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)). Walk the user through [`docs/wiki-structure.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/wiki-structure.md) rather than re-deriving a structure in the interview — it carries the tree, per-folder ownership, the sources rules and a four-folder starting point. In short:
  - `00_Start-Here/` with `index.md` (a **content-oriented catalog** of every page — the entry point agents read first), `log.md` (an **append-only ledger**: `## [YYYY-MM-DD] <type> | <title>` per change), `Templates/` and `Team/` (one page per member — the target for `owner:`)
  - `01_Sources/` for **raw, immutable** artifacts (transcripts, feedback, regulations, exports, screenshots): agents read them and write *new* wiki pages — never edit or delete a source, so a wrong interpretation can always be redone from the artifact. Filename `YYYY-MM-DD - <origin> - <title>`, every ingest logged in `log.md` with the pages it changed.
  - `02_Product/` (vision, scope, `Reports/` + `Reports/_definitions/`) · `03_Legal/` (rename to the project's guardrail domain: Clinical, Safety, Regulatory…) · `04_Discovery/` (research, evaluations, unsorted) · `05_Requirements/Tickets/` (**the ticket folder Dispatch will point at**) + `Non-Functional/` · `06_UX/` · `07_Engineering/` (incl. `Decisions/` for ADRs) · `08_Delivery-and-QA/Releases/` (release notes with `version`/`date` — feeds the Release Plan tab) · `09_Meetings/` (feeds the Meetings tab) · `10_Archive/`
  - Numbers are sort keys, not law — adapt names and domains to the project, and never renumber a live vault to close a gap.
  - Conventions to write into `index.md`: a page is authoritative only with `status: approved` + `source_of_truth: true`; a precedence order for conflicts (**their** order — it describes how the team actually works, not a universal truth); every change gets a `log.md` entry. Seed `Templates/` with a ticket template carrying the full frontmatter set from step 1 and the [contract/record zone markers](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md#the-freeze-rule).
- Which folder(s) hold ticket notes? Which frontmatter property is the **status**, and what is the exact status vocabulary (order matters — it becomes the Kanban columns)?
- Per status: display label? milestone **progress** weight (0–100, or excluded — e.g. Rejected)? **WIP limit**?
- Which property holds the **target version** (milestones)? Which versions are planned? Release notes folder with `version`/`date` frontmatter?
- Which properties exist / should exist: `assignee`, `size`, `open_questions`, `open_tests`, `discussion` (thread URL)? Required properties for the problems panel (typically `id, status, updated`)?
- Meetings folder (optional third tab)?
- Grep a few real ticket notes to validate every answer against reality — inconsistent value formats (e.g. `v1.2.0` vs `1.2.0`) are normal; Dispatch normalizes versions by major.minor, but statuses must match exactly.
- **Last step — propose workflow skills for the CODE repo (the glue).** Chips only carry `/command {{id}}` one-liners; the actual workflow logic must live as Claude skills (`.claude/commands/*.md`) **in the user's code repository** — not the wiki — so it versions with the code, travels through git to every teammate, and is reviewable like code. Derive a catalog from their lifecycle and offer to scaffold it, each skill pre-wired to a chip:
  | Skill (repo) | Chip (Dispatch) | Does |
  |---|---|---|
  | `/create-ticket <desc>` | block chips in reports/meeting notes | duplicate check → spec (full frontmatter, counters seeded) + tracker task, wiki hygiene |
  | `/refine <id>` | ticket cards | read spec + linked context, open a team thread (`discussion:`), maintain `open_questions` → 0 gates the next status |
  | `/update-ticket <id>` | ticket cards | fold inline/thread/tracker feedback into the spec, recount counters |
  | `/implementation-plan <id>` | ticket cards | feedback first, then plan mode, plan stored in the spec |
  | `/develop <id>` | ticket cards | preconditions, status move, set `assignee`, implement with tests |
  | `/test-plan <id>` | ticket cards | manual-only checklist (excluding automated coverage), set `open_tests`, status move |
  | `/release [version]` | manual / release chip | test pass, version bump, release note with `version`/`date` frontmatter (feeds Milestones), promote tickets, announce |
  | `/meeting agenda\|report` | meeting cards | agenda file; transcript → interpreted report with checkbox action items (the format the Meetings tab counts), decisions folded into the affected tickets |
  | `/daily-routine`, `/weekly-maintenance` | manual / scheduled | sync-and-surface passes: fold feedback, reconcile wiki ↔ tracker, run the report suite from rulebooks in `02_Product/Reports/_definitions/` |
  Adapt names, statuses and tracker calls to their answers; every status move must update wiki frontmatter *and* tracker per the source-of-truth decision (step 6). Skills reference repos only via Dispatch's alias mechanism — never hardcode machine paths. The fuller catalog, with what each skill reads and writes, is [`docs/skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md).

## 2 · Shared config (`<vault>/.obsidian/plugins/dispatch/data.json`)

Write the full settings object: `board` (sourceFolders, statusProperty, orderProperty, columns with label/progress/wip, titleProperty, assigneeProperty, badgeProperties, questionsProperty, testsProperty, discussionProperty, requiredProperties, automations), `milestones` (versionProperty, plannedVersions in canonical write form, tags, sizeProperty, completedProperty, velocityWindowDays, releaseNotesFolder), `meetings`, `todos`, `chips` (defaultTool, templates). [`docs/installation.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/installation.md) documents every field. **Shared config must never contain absolute paths** — repositories are referenced by alias only. Obsidian reads it at plugin load → tell the user to click the board's ↻ reload button afterwards.

## 3 · Device config (`~/.dispatch/<vault>-<hash>.json`)

Per machine, never synced. Set up on THIS machine and tell teammates to repeat (Settings → Dispatch → This device shows the exact path):
- `repos`: alias → absolute path (e.g. `"my-app": "C:\\Users\\me\\code\\my-app"`).
- `tools`: launch templates. **Windows: use `start`, never `wt.exe`** (Windows Terminal parses `;` inside quoted args as a tab separator): `start "Dispatch" /d {{cwd}} cmd /k claude {{prompt}}`. macOS: `osascript -e 'tell app "Terminal" to do script "cd " & quoted form of {{cwd}} & " && claude " & quoted form of {{prompt}}'`.
- Keep `confirmBeforeRun: true`; `enableHooks` stays false until the automation command is trusted.

## 4 · Chip templates + workflow commands

- Define **virtual chip templates** in `data.json` (`label | tool | repo | prompt`, variables `{{id}}`, `{{status}}`, `{{file}}`, `{{title}}`). Best practice: prompts are slash commands (`/refine {{id}}`) whose step-by-step logic lives as project commands in the target repo's `.claude/commands/` — offer to scaffold those (create/refine/update/develop/test-plan lifecycle) adapted to the user's tracker and conventions.
- YAML gotcha for block chips in notes: quote values containing `:` or `#`.

## 5 · Project invariants (`CLAUDE.md` in the code repo)

Rules that **every** skill must respect belong in the repo's `CLAUDE.md`, not copied into each skill — a rule copied six times holds in four. Write these, adapted to their vocabulary:

- **The ticket freeze.** Once a ticket leaves development (the status where code exists that depends on it), its **contract zone** — goal/symptom, acceptance criteria, open questions + answers, scope, implementation plan — is read-only; stamp `frozen: <date>`. New information goes into the **record zone** (as-built notes, test results, follow-ups) as a dated entry; a wrong frozen statement gets an annotation (`> ⚠️ Correction <date>: …`) beneath it, never a rewrite; new scope becomes a new linked ticket. Rationale: if a spec can change after the code was built against it, a later spec↔code mismatch has two explanations and no way to tell them apart. Details: [`docs/page-types.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md#the-freeze-rule).
- **Ownership + maintenance.** Every page carries `owner:` (a **person**, resolving to `00_Start-Here/Team/` — never a team). Every *derived* page also carries `derived_from:` and `maintained_by:`, and **a skill that creates a derived page must register its refresh** — if no recurring job owns it, it may not create it.
- **Precedence** when documents conflict, plus which side wins on a wiki ↔ tracker disagreement (recommend: the wiki).
- **Gates are gates:** `open_questions: 0` before leaving refinement, `open_tests: 0` before leaving review; no skill moves a ticket across a gated boundary on its own.

## 6 · Tracker sync (optional but the biggest win)

Add an automation rule in `data.json` so drags push to the tracker:
```json
{ "when": [], "set": {}, "repo": "<alias>", "command": "node scripts/move-ticket.mjs {{file}} {{from}} {{to}}" }
```
Scaffold `scripts/move-ticket.mjs` in their repo: map status → tracker column/section ID, find the task by the ticket-ID naming convention, move it via the tracker's API (token from env/.env — never hardcode), print ONE line (it becomes the Obsidian notice). Statuses without a tracker column: print a skip message, exit 0. **Windows: never `process.exit()` after async work** (libuv teardown race → false failures) — set `process.exitCode` and return. A `--dry-run` flag makes it testable. Add a `set` rule for completion stamping too: `{ "when": ["Done"], "set": { "done": "{{date}}" } }` — it feeds the milestone velocity forecast (completedProperty).
Decide with the user which side is the **source of truth** (recommend: the vault; tracker follows) and write that down in their project docs. Then enable *automation commands on this device*.

## 7 · Run-lifecycle hooks (Claude Code)

So board cards show started → running ⇄ waiting → done and completed runs log back into the note:
1. Scaffold `scripts/dispatch-run-state.mjs` in their repo: appends `{id, state, ts}` to `$DISPATCH_RUNS_FILE`; on `done` also appends a run-log line + final-assistant-message excerpt (from the hook's stdin `transcript_path`) to the note at `$DISPATCH_NOTE` under `## Dispatch runs`. Silent no-op when `DISPATCH_RUN_ID` is unset. ([`docs/installation.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/installation.md#run-lifecycle) describes the contract; a reference implementation lives in the plugin repo history.)
2. Wire `.claude/settings.json` hooks: `SessionStart`→running, `UserPromptSubmit`→running, `Stop`→waiting, `SessionEnd`→done.
3. Semantics to explain: **done fires when the claude process exits** (`/exit`), not when it finishes answering — that's what `waiting` is for. Ghost badges (killed terminals) are cleared via badge-click → menu.

## 8 · Smoke test (walk the user through, verify each)

1. ↻ reload → Kanban shows the configured columns; ⚠ problems panel reviewed (fix malformed tickets now, not later).
2. Drag a card one column → frontmatter updated + tracker moved (if step 5) + notice shown.
3. Right-click a card → chip launches the agent in the right repo; badge lifecycle runs through; `## Dispatch runs` line appears on session exit.
4. Milestones tab: versions grouped correctly, released columns link their notes, forecasts only on unreleased versions.

## Known pitfalls (tell the user proactively when relevant)

- Statuses are matched exactly — unify quoted/unquoted YAML variants is unnecessary (same value), but typos/casing split columns.
- Chips/board are desktop-only; mobile shows nothing.
- A chip aborts with a notice if a referenced variable (e.g. `{{id}}`) is empty — that means the note's frontmatter is incomplete, see the ⚠ panel.
- Meeting/action-item counting parses `- [ ]` checkbox lines (bold owner lines for attribution) — agents editing notes must preserve that format.
- `data.json` edits from outside Obsidian need the ↻ reload button.
