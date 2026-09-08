---
name: dispatch-setup
description: Guided integration of the Dispatch Obsidian plugin into a project — configure the boards (data.json), device-local config, agent chip tools, workflow commands, tracker sync automation and run-lifecycle hooks. Use when the user wants to set up, configure, or connect Dispatch to their vault, repo, tracker or coding agent.
---

# Dispatch setup

You are integrating the **Dispatch** Obsidian plugin (the agentic ticket board) into the user's project. Work interactively: interview → write config → verify. Never invent team conventions — ask, or read them from the user's existing notes.

Assume the user has **no other Dispatch project to copy from**. Everything needed to produce a working setup is in this skill; the reference docs below add depth and rationale.

## The Dispatch documentation

These live in the plugin repository, **not** in this skill's package — fetch them at `https://github.com/kaimys/obsidian-dispatch/blob/main/docs/<file>` (or read them locally if the user has the repo checked out, e.g. as a plugin dev install under `<vault>/.obsidian/plugins/dispatch/docs/`).

| Doc | What's in it | Read it when |
| --- | --- | --- |
| [`overview.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/overview.md) | The four boards — Kanban, Release Plan, Meetings, Todos — what each shows, the badge semantics, and what the board deliberately does *not* do | The user asks what Dispatch actually gives them, or which tabs are worth configuring |
| [`wiki-structure.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/wiki-structure.md) | The three layers, the example folder tree, per-folder ownership, the immutable-sources rule, `index.md`/`log.md`, and where the wiki lives relative to the code (symlink vs. monorepo) | There's no vault or no wiki structure yet, or tickets are scattered across folders (step 1) |
| [`page-types.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md) | The frontmatter contract per page type — tickets (incl. the freeze rule and contract/record zones), ADRs, releases, meetings, legal/domain docs, reports | Deciding ticket frontmatter, scaffolding a ticket template, or writing the `CLAUDE.md` invariants (steps 1 and 5) |
| [`skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md) | The workflow-skill catalog — what each `/command` reads and writes, and how skills wire to chips | Scaffolding the code repo's `dispatch/workflow/` and the per-agent stubs (steps 1 and 4) |
| [`installation.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/installation.md) | Settings reference, chips and tool commands, run lifecycle, automations, security model — and [the on-disk JSON shapes](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/installation.md#the-config-files-on-disk) | Writing `data.json` or the device config directly (steps 2, 3 and 7) |

The authoritative schema — every field, every default — is `src/settings.ts` in that repo.

## 0 · Preflight

1. Locate the **Obsidian vault** and confirm Dispatch is installed (`<vault>/.obsidian/plugins/dispatch/` with `main.js` + `manifest.json`) and enabled (`community-plugins.json`).
   **Not installed? Have the user install it from the community directory** — *Settings → Community plugins → Browse*, search **Dispatch**, install and enable. Do not download release assets or write plugin files yourself: the directory build is signed for the user's Obsidian and updates itself, and a hand-placed copy silently stops receiving updates.
   Requires Restricted mode to be off; that switch is the user's to flip, never flip it for them silently.
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
  - Conventions to write into `index.md`: a page is authoritative only with `status: approved` + `source_of_truth: true`; a precedence order for conflicts (**their** order — it describes how the team actually works, not a universal truth); every change gets a `log.md` entry. Seed `Templates/` from **`assets/templates/`** in this skill (story, bug, ADR, release note, meeting) — they already carry the full frontmatter contract and the [contract/record zone markers](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md#the-freeze-rule); replace their `<<PLACEHOLDER>>` tokens per `assets/templates/README.md`. **Templates are not cosmetic:** the release-note `version`/`date` and the meeting `- [ ]` action-item format are parsed by the Release Plan and Todos tabs, so a hand-improvised note silently drops off the board.
- Which folder(s) hold ticket notes? Which frontmatter property is the **status**, and what is the exact status vocabulary (order matters — it becomes the Kanban columns)?
- Per status: display label? milestone **progress** weight (0–100, or excluded — e.g. Rejected)? **WIP limit**?
- Which property holds the **target version** (milestones)? Which versions are planned? Release notes folder with `version`/`date` frontmatter?
- Which properties exist / should exist: `assignee`, `size`, `open_questions`, `open_tests`, `open_findings`, `discussion` (thread URL)? Required properties for the problems panel (typically `id, status, updated`)?
- Meetings folder (optional third tab)?
- Grep a few real ticket notes to validate every answer against reality — inconsistent value formats (e.g. `v1.2.0` vs `1.2.0`) are normal; Dispatch normalizes versions by major.minor, but statuses must match exactly.
- **Last step — propose workflow skills for the CODE repo (the glue).** Chips only carry `/command {{id}}` one-liners; the actual workflow logic must live **in the user's code repository** — not the wiki — so it versions with the code, travels through git to every teammate, and is reviewable like code. Derive a catalog from their lifecycle and offer to scaffold it, each skill pre-wired to a chip:
  | Skill (repo) | Chip (Dispatch) | Does |
  |---|---|---|
  | `/create-ticket <desc>` | block chips in reports/meeting notes | duplicate check → spec (full frontmatter, counters seeded) + tracker task, wiki hygiene |
  | `/refine <id>` | ticket cards | read spec + linked context, open a team thread (`discussion:`), maintain `open_questions` → 0 gates the next status |
  | `/update-ticket <id>` | ticket cards | fold inline/thread/tracker feedback into the spec, recount counters |
  | `/implementation-plan <id>` | ticket cards | feedback first, then plan mode, plan stored in the spec |
  | `/develop <id>` | ticket cards | preconditions, status move, set `assignee`, implement with tests |
  | `/code-review <id>` | ticket cards | reviewer ≠ author by construction; criteria, plan, diff and seams; findings into the ticket's `## Code review`, `open_findings`, and `/test-plan` blocked while a criterion fails |
  | `/test-plan <id>` | ticket cards | manual-only checklist (excluding automated coverage), set `open_tests`, status move |
  | `/release [version]` | manual / release chip | test pass, version bump, release note with `version`/`date` frontmatter (feeds Milestones), promote tickets, announce |
  | `/meeting agenda\|report` | meeting cards | agenda file; transcript → interpreted report with checkbox action items (the format the Meetings tab counts), decisions folded into the affected tickets |
  | `/daily-routine`, `/weekly-maintenance` | manual / scheduled | sync-and-surface passes: fold feedback, reconcile wiki ↔ tracker, run the report suite from rulebooks in `02_Product/Reports/_definitions/` |
    **Don't write these from scratch — a starter set ships with this skill in `assets/commands/`** (`create-ticket`, `refine`, `update-ticket`, `implementation-plan`, `develop`, `test-plan`, `code-review`, `release`, `meeting`). Copy them into the repo as `dispatch/workflow/<name>.md` and replace the `<<PLACEHOLDER>>` tokens documented in `assets/commands/README.md`; then grep for `<<` to prove none survived.

    **One canonical file, one stub per agent.** The workflow body goes to `dispatch/workflow/<name>.md` — one file, whichever agents the user runs. Each agent then gets a **stub** that carries only its own format's frontmatter and a pointer to that file, and no steps:

    | Agent | Stub | Frontmatter it needs |
    | --- | --- | --- |
    | Claude Code | `.claude/commands/<name>.md` | `description`, `argument-hint` |
    | Codex | `.codex/skills/<name>/SKILL.md` | `name`, `description` |

    A stub says *read `dispatch/workflow/<name>.md` now and follow it exactly*, and substitutes the argument the caller passed. Writing steps into a stub is the failure to avoid: the other agent never sees them, and nothing errors — it just quietly improvises. Grepping a stub for a workflow term (`open_questions`, `frozen:`) must come back empty. Adapt names, statuses and tracker calls to their answers; every status move must update wiki frontmatter *and* tracker per the source-of-truth decision (step 6). Skills reference repos only via Dispatch's alias mechanism — never hardcode machine paths. The fuller catalog, with what each skill reads and writes, is [`docs/skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md).

## 2 · Shared config (`<vault>/.obsidian/plugins/dispatch/data.json`)

Write the **full** settings object — missing keys fall back to defaults, but a complete file is readable and diffable. **Shared config must never contain absolute paths**: repositories are referenced by alias only. Obsidian reads it at plugin load → tell the user to click the board's ↻ reload button afterwards.

⚠️ The settings *UI* shows compact input forms (`value | Label | progress | WIP`, `tool = command`). **The stored JSON has a different shape.** Write this skeleton and fill it from the interview:

```json
{
  "board": {
    "sourceFolders": ["05_Requirements/Tickets"],
    "statusProperty": "status",
    "orderProperty": "rank",
    "columns": [
      { "value": "Draft", "progress": 0 },
      { "value": "Refinement", "progress": 30, "wip": 4 },
      { "value": "Development", "progress": 70, "wip": 3 },
      { "value": "Done", "progress": 100 },
      { "value": "Rejected", "excluded": true }
    ],
    "titleProperty": "id",
    "assigneeProperty": "assignee",
    "badgeProperties": ["type", "priority", "version_target"],
    "questionsProperty": "open_questions",
    "testsProperty": "open_tests",
    "findingsProperty": "open_findings",
    "discussionProperty": "discussion",
    "requiredProperties": ["id", "status", "updated"],
    "automations": [
      { "when": ["Done"], "set": { "completed": "{{date}}" }, "repo": "", "command": "" }
    ]
  },
  "milestones": {
    "versionProperty": "version_target",
    "plannedVersions": ["v1.1.0", "v1.2.0"],
    "tags": { "1.2": "Beta" },
    "sizeProperty": "size",
    "completedProperty": "completed",
    "velocityWindowDays": 28,
    "releaseNotesFolder": "08_Delivery-and-QA/Releases"
  },
  "meetings": {
    "folder": "",
    "dateProperty": "meeting_date",
    "participantsProperty": "participants",
    "actionsProperty": "open_actions",
    "templates": [],
    "calendarFilter": "",
    "calendarLookaheadDays": 14,
    "calendarChips": []
  },
  "todos": {
    "folders": [],
    "sections": ["Action items", "Open action items"],
    "assignees": [],
    "fallbackAssignee": "Team"
  },
  "chips": {
    "defaultTool": "claude",
    "templates": [
      { "label": "Start refinement", "tool": "claude", "repo": "my-app", "prompt": "/refine {{id}}" },
      { "label": "Code review", "tool": "claude", "repo": "my-app", "prompt": "/code-review {{id}}" }
    ],
    "columnTemplates": [
      { "label": "Refine all tickets", "tool": "claude", "repo": "my-app", "prompt": "Work through these tickets sequentially with the full /refine workflow: {{ids}}." }
    ]
  }
}
```

Mistakes that silently produce a broken board:

- Columns are **objects**, not pipe strings. The UI's `-` progress becomes `"excluded": true` — *never* `"progress": "-"`. Omit `label` to display the raw value; omit `wip` for no limit.
- `chips.templates` (card chips) and `chips.columnTemplates` (batch chips on the column header; prompts get `{{ids}}`, `{{status}}`, `{{count}}`) are **separate lists**.
- Empty means off: `meetings.folder: ""` hides the Meetings tab, `todos.folders: []` hides Todos, `milestones.completedProperty: ""` disables the forecast, `board.orderProperty: ""` disables manual ordering, and an empty badge property drops that badge.
- `milestones.tags` is keyed by normalized `major.minor` (`"1.2"`), `plannedVersions` by the canonical write form (`"v1.2.0"`) — a drop writes that exact string.
- Every automation rule carries all four keys; a `set`-only rule keeps `"repo": ""` and `"command": ""`.

Whatever you set for `completedProperty` must actually be **stamped by an automation rule** (`set`), or the velocity forecast never gets data. Field-by-field reference: [`installation.md` → The config files on disk](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/installation.md#the-config-files-on-disk).

## 3 · Device config (`~/.dispatch/<vault>-<hash>.json`)

Per machine, never synced. Set it up on THIS machine and tell teammates to repeat it (*Settings → Dispatch → This device* shows each person their exact path):

```json
{
  "repos": { "my-app": "C:\\Users\\me\\Workspace\\my-app" },
  "tools": {
    "claude": { "command": "start \"Dispatch\" /d {{cwd}} cmd /k claude {{prompt}}" }
  },
  "calendarUrl": "",
  "enableHooks": false,
  "confirmBeforeRun": true
}
```

- `tools` maps a name to an **object** (`{"command": "…"}`), never to a bare string — the most common hand-editing mistake.
- **Windows: use `start`, never `wt.exe`** (Windows Terminal parses `;` inside quoted args as a tab separator). macOS: `osascript -e 'tell app "Terminal" to do script "cd " & quoted form of {{cwd}} & " && claude " & quoted form of {{prompt}}'`.
- `repos` is the only place absolute paths may appear anywhere in Dispatch's config.
- Keep `confirmBeforeRun: true`; `enableHooks` stays false until the automation command is trusted (it gates automation **commands** only — `set` assignments always apply).

**Deriving the filename headlessly** — prefer reading it from the settings tab when Obsidian is at hand. Vault name = `getName()` with each run of non-`[\w.-]` characters replaced by `_`; hash = djb2 over the vault's **absolute path** (backslashes included on Windows), unsigned 32-bit, hex:

```js
let hash = 5381;
for (let i = 0; i < vaultPath.length; i++) hash = ((hash << 5) + hash + vaultPath.charCodeAt(i)) >>> 0;
const filename = `${vaultName}-${hash.toString(16)}.json`;   // e.g. MyVault-6ed580a0.json
```

If the user already runs Dispatch on another vault, sanity-check the algorithm by reproducing that vault's existing `~/.dispatch/*.json` filename before writing a new one. The runs file lives beside it under the same basename: `~/.dispatch/runs/<vault>-<hash>.jsonl`.

## 4 · Chip templates + workflow commands

- Define **virtual chip templates** in `data.json` — objects `{ "label": …, "tool": …, "repo": …, "prompt": … }` (the `label | tool | repo | prompt` form is the settings UI's input syntax, not the stored shape). Card prompts get `{{id}}`, `{{status}}`, `{{file}}`, `{{title}}`; column-header prompts get `{{ids}}`, `{{status}}`, `{{count}}`; meeting and calendar chips get `{{date}}` and `{{title}}`.
- Best practice: prompts are one-liners (`/refine {{id}}` for Claude, `$refine {{id}}` for Codex) whose step-by-step logic lives in the target repo's `dispatch/workflow/`, with a thin stub per agent. Scaffold them from **`assets/commands/`** in this skill rather than improvising — nine workflows covering the ticket loop, releases and meetings, each a `<<PLACEHOLDER>>` search-and-replace away from working. **The prompt differs per agent only by its leading character**, so set the tool's prompt prefix in the device config (`codex = $`) rather than writing a prompt per chip. Their vault-side counterparts (ticket, bug, ADR, release-note and meeting templates) are in **`assets/templates/`**. Rationale and catalog: [`skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md), [`page-types.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md).
- Chip labels must match what the commands are actually called — a chip firing `/refine` at a repo with no `refine.md` fails only at click time, with a confusing error.
- Every `repo` alias used by a chip must exist in the device config, and the `tool` must be defined there too — otherwise the chip fails only at click time. Check both after writing the two files.
- YAML gotcha for block chips in notes: quote values containing `:` or `#`.

## 5 · Project invariants (one shared file in the code repo)

Rules that **every** skill must respect belong in **one** file, not copied into each skill — a rule copied six times holds in four, and a rule copied into two agents' instruction files holds in one.

**Write them to `dispatch/invariants.md`, then give each agent the user runs a pointer at it:**

| Agent | Instruction file | Contains |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` | a pointer to `dispatch/invariants.md`, plus what is genuinely Claude-specific (its hook wiring, its session-title call) |
| Codex | `AGENTS.md` | a pointer to the same file, plus what is genuinely Codex-specific (its hook wiring, hook trust, `$name` invocation) |

Create the pointer file for **every** agent chosen in step 1 — a Codex-only project with no `AGENTS.md` has no instruction entry point at all, and the invariants below simply never reach the agent. Neither pointer file restates a rule; if the two ever disagree, the shared file wins.

Write these, adapted to their vocabulary:

- **The ticket freeze.** Once a ticket leaves development (the status where code exists that depends on it), its **contract zone** — goal/symptom, acceptance criteria, open questions + answers, scope, implementation plan — is read-only; stamp `frozen: <date>`. New information goes into the **record zone** (as-built notes, test results, follow-ups) as a dated entry; a wrong frozen statement gets an annotation (`> ⚠️ Correction <date>: …`) beneath it, never a rewrite; new scope becomes a new linked ticket. Rationale: if a spec can change after the code was built against it, a later spec↔code mismatch has two explanations and no way to tell them apart. Details: [`docs/page-types.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md#the-freeze-rule).
- **Ownership + maintenance.** Every page carries `owner:` (a **person**, resolving to `00_Start-Here/Team/` — never a team). Every *derived* page also carries `derived_from:` and `maintained_by:`, and **a skill that creates a derived page must register its refresh** — if no recurring job owns it, it may not create it.
- **Precedence** when documents conflict, plus which side wins on a wiki ↔ tracker disagreement (recommend: the wiki).
- **Gates are gates:** `open_questions: 0` before leaving refinement, `open_findings: 0` before the test plan is written (the code review runs before the freeze), `open_tests: 0` before leaving review; no skill moves a ticket across a gated boundary on its own.
- **Unset is not zero.** An empty counter is *no statement* and renders no badge; `0` is *counted, and clear*. So a new ticket leaves `open_tests:` and `open_findings:` empty rather than seeding `0`, and a skill that invalidates a count — fixing code under a review, say — clears the property instead of writing `0`. Only the skill that actually counted may write a number, or the gate can be satisfied by a stale one.

## 6 · Tracker sync (optional but the biggest win)

Add an automation rule in `data.json` so drags push to the tracker:
```json
{ "when": [], "set": {}, "repo": "<alias>", "command": "node scripts/move-ticket.mjs {{file}} {{from}} {{to}}" }
```
Scaffold `scripts/move-ticket.mjs` in their repo: map status → tracker column/section ID, find the task by the ticket-ID naming convention, move it via the tracker's API (token from env/.env — never hardcode), print ONE line (it becomes the Obsidian notice). Statuses without a tracker column: print a skip message, exit 0. **Windows: never `process.exit()` after async work** (libuv teardown race → false failures) — set `process.exitCode` and return. A `--dry-run` flag makes it testable. Add a `set` rule for completion stamping too: `{ "when": ["Done"], "set": { "done": "{{date}}" } }` — it feeds the milestone velocity forecast (completedProperty).
Decide with the user which side is the **source of truth** (recommend: the vault; tracker follows) and write that down in their project docs. Then enable *automation commands on this device*.

## 7 · Run-lifecycle hooks

So board cards show launched → running ⇄ waiting → done and completed runs log back into the note. **Wire this for every agent the user runs** (step 1's interview) — one script serves them all:

1. **Copy the reference implementation that ships with this skill** — `assets/run-state.mjs` in this skill's own directory — into the target repo as `scripts/dispatch/run-state.mjs`. It is dependency-free, fully synchronous and needs no edits. (What it does: appends `{id, state, ts}` to `$DISPATCH_RUNS_FILE`; on `done` also appends a run-log line plus an excerpt of the agent's final message — read from the `transcript_path` in the hook's **stdin JSON**, not from an env var — to `$DISPATCH_NOTE` under `## Dispatch runs`, newest first; silent no-op when `DISPATCH_RUN_ID` is unset, so normal sessions are undisturbed. Contract: [`installation.md` → Run lifecycle](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/installation.md#run-lifecycle).)
2. Wire the four events for each agent, in the **target repo**, by **copying** the matching asset from this skill's directory and merging it into any existing file (never overwrite one). Both map `SessionStart` and `UserPromptSubmit` → `running`, `Stop` → `waiting`, `SessionEnd` → `done`.

   | Agent | Target file | Asset to copy |
   | --- | --- | --- |
   | Claude Code | `.claude/settings.json` | `assets/claude-settings-hooks.json` |
   | Codex | `.codex/hooks.json` | `assets/codex-hooks.json` |

   The two formats are **not** interchangeable. Claude takes a `command` + `args` array, which survives spaces in the project path; Codex takes a single `command` **string** and nests the events under a top-level `hooks` key. Copy the file for the agent you are wiring; do not translate one into the other.

   ⚠️ **Copy that file — do not retype the JSON from memory or from anything quoted in these instructions.** Each hook path must remain the *literal, unexpanded* project-directory variable (the `CLAUDE_PROJECT_DIR` name in dollar-brace form, exactly as the file has it). That variable is **substituted when this skill is rendered**, so instructions that inline the JSON can reach you with a real absolute path already baked in — and writing that into `.claude/settings.json` hardcodes one machine into a file the whole team commits. After merging, grep the result for the drive letter or home directory: if you find one, you retyped it instead of copying it.
3. **Verify it without Obsidian** before the smoke test: set the five `DISPATCH_*` variables by hand, run the script for `running`, `waiting` and `done` (piping `{"transcript_path":"…"}` on stdin for the last), then check that the runs file gained three records and a scratch note gained its `## Dispatch runs` entry. On Windows pass **native paths** (`C:\…`) — a Git-Bash `/c/…` path makes the note lookup silently no-op and looks like a broken hook.
4. Semantics to explain: **done fires when the agent process exits** (`/exit`), not when it finishes answering — that's what `waiting` is for. Ghost badges (killed terminals) are cleared via badge-click → menu.
5. ⚠️ **Codex only — the hooks do nothing until they are trusted, and every failure here is silent.** Walk the user through this explicitly; it is the single most likely reason a correct setup looks broken:
   - Have them run `codex` **interactively** once in the repo and accept the hook-trust prompt. `codex exec` does not run these hooks, so it cannot be used to test them.
   - Trust is recorded **per hook entry and hashed** (`~/.codex/config.toml`, `[hooks.state.'<file>:<event>:…']`). **Editing `.codex/hooks.json` un-trusts what you changed**, silently — after any edit, re-accept and re-verify.
   - The file path is `.codex/hooks.json`. A hooks file at any other path produces **no warning at all**, and a malformed one produces only a warning while the session runs on regardless. **Never treat a clean startup as evidence the hooks are live** — confirm by watching a badge change.

## 8 · Smoke test

**Verify headlessly first.** All of this is checkable before the user opens Obsidian, and a failure here would otherwise surface as an apparent plugin bug:

- every JSON file parses — `data.json`, `community-plugins.json`, the device config, and the hook config of each agent wired in step 7 (`.claude/settings.json`, `.codex/hooks.json`);
- every chip `repo` alias resolves to a directory that exists on this device, and every `tool` a chip names is defined in the device config;
- for each note in the source folders: required properties present, the `status` value matches a configured column **exactly** (this is what the ⚠ panel flags), `version_target` present in `plannedVersions`, and each counter property (`open_questions`, `open_tests`, `open_findings`) either **empty** — nothing has counted it yet — or equal to the actual number of open items in its section; a `0` on a ticket whose section does not exist yet is the failure worth looking for, because it reads as a passed gate;
- `milestones.completedProperty` is actually stamped by an automation rule, and matches the completion property in the ticket templates;
- **no `<<PLACEHOLDER>>` survived** in the scaffolded workflow files or templates — `grep -r '<<' <workflow dir> <vault>/<templates>` must come back empty;
- every chip prompt names a command that exists in the repo;
- **`.claude/settings.json` contains no absolute path** — the hook paths must still be the unexpanded project-directory variable (step 7.2). A drive letter or home directory in there is the single easiest way to commit one machine's layout to the whole team;
- the run-state hook behaves (step 7.3);
- **the invariants file and every chosen agent's pointer exist** (step 5) — `dispatch/invariants.md`, plus `CLAUDE.md` and/or `AGENTS.md`; and grepping a pointer file for a rule it should only be pointing at (the freeze, a gate counter) comes back empty;
- **for Codex: hook trust has actually been granted** (step 7.5). Check `~/.codex/config.toml` for a `[hooks.state.…]` entry naming the repo's `.codex/hooks.json`. Its absence, with everything else correct, is exactly the state that looks like a broken plugin.

Then walk the user through the UI, verifying each:

1. ↻ reload → Kanban shows the configured columns; ⚠ problems panel reviewed (fix malformed tickets now, not later).
2. Drag a card one column → frontmatter updated + tracker moved (if step 6) + notice shown.
3. Right-click a card → chip launches the agent in the right repo; badge lifecycle runs through; `## Dispatch runs` line appears on session exit, naming the agent that ran. **With more than one agent configured the chip asks which to run** — check that each button previews its own command, and run the cycle on each agent, not just the first.
4. Milestones tab: versions grouped correctly, released columns link their notes, forecasts only on unreleased versions.

## Known pitfalls (tell the user proactively when relevant)

- **Writing the settings UI's display forms into the JSON files** — pipe-delimited column strings, `"progress": "-"` instead of `"excluded": true`, or `"tools": {"claude": "start …"}` instead of `{"command": "…"}`. The file still parses; the board silently ignores it. See steps 2 and 3.
- If the vault lives **inside the code repo**, check whether it is git-ignored before telling the user teammates will receive the board config — a `docs/wiki` in `.gitignore` makes the "shared" layer device-local in practice.
- Statuses are matched exactly — unify quoted/unquoted YAML variants is unnecessary (same value), but typos/casing split columns.
- Chips/board are desktop-only; mobile shows nothing.
- A chip aborts with a notice if a referenced variable (e.g. `{{id}}`) is empty — that means the note's frontmatter is incomplete, see the ⚠ panel.
- Meeting/action-item counting parses `- [ ]` checkbox lines (bold owner lines for attribution) — agents editing notes must preserve that format.
- `data.json` edits from outside Obsidian need the ↻ reload button.
