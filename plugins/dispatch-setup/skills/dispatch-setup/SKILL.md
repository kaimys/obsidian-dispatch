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

- Which folder(s) hold ticket notes? Which frontmatter property is the **status**, and what is the exact status vocabulary (order matters — it becomes the Kanban columns)?
- Per status: display label? milestone **progress** weight (0–100, or excluded — e.g. Rejected)? **WIP limit**?
- Which property holds the **target version** (milestones)? Which versions are planned? Release notes folder with `version`/`date` frontmatter?
- Which properties exist / should exist: `assignee`, `size`, `open_questions`, `open_tests`, `discussion` (thread URL)? Required properties for the problems panel (typically `id, status, updated`)?
- Meetings folder (optional third tab)?
- Grep a few real ticket notes to validate every answer against reality — inconsistent value formats (e.g. `v1.2.0` vs `1.2.0`) are normal; Dispatch normalizes versions by major.minor, but statuses must match exactly.

## 2 · Shared config (`<vault>/.obsidian/plugins/dispatch/data.json`)

Write the full settings object: `board` (sourceFolders, statusProperty, orderProperty, columns with label/progress/wip, titleProperty, assigneeProperty, badgeProperties, questionsProperty, testsProperty, discussionProperty, requiredProperties, automations), `milestones` (versionProperty, plannedVersions in canonical write form, tags, sizeProperty, completedProperty, velocityWindowDays, releaseNotesFolder), `meetings`, `chips` (defaultTool, templates). The README documents every field. **Shared config must never contain absolute paths** — repositories are referenced by alias only. Obsidian reads it at plugin load → tell the user to click the board's ↻ reload button afterwards.

## 3 · Device config (`~/.dispatch/<vault>-<hash>.json`)

Per machine, never synced. Set up on THIS machine and tell teammates to repeat (Settings → Dispatch → This device shows the exact path):
- `repos`: alias → absolute path (e.g. `"my-app": "C:\\Users\\me\\code\\my-app"`).
- `tools`: launch templates. **Windows: use `start`, never `wt.exe`** (Windows Terminal parses `;` inside quoted args as a tab separator): `start "Dispatch" /d {{cwd}} cmd /k claude {{prompt}}`. macOS: `osascript -e 'tell app "Terminal" to do script "cd " & quoted form of {{cwd}} & " && claude " & quoted form of {{prompt}}'`.
- Keep `confirmBeforeRun: true`; `enableHooks` stays false until the automation command is trusted.

## 4 · Chip templates + workflow commands

- Define **virtual chip templates** in `data.json` (`label | tool | repo | prompt`, variables `{{id}}`, `{{status}}`, `{{file}}`, `{{title}}`). Best practice: prompts are slash commands (`/refine {{id}}`) whose step-by-step logic lives as project commands in the target repo's `.claude/commands/` — offer to scaffold those (create/refine/update/develop/test-plan lifecycle) adapted to the user's tracker and conventions.
- YAML gotcha for block chips in notes: quote values containing `:` or `#`.

## 5 · Tracker sync (optional but the biggest win)

Add an automation rule in `data.json` so drags push to the tracker:
```json
{ "when": [], "set": {}, "repo": "<alias>", "command": "node scripts/move-ticket.mjs {{file}} {{from}} {{to}}" }
```
Scaffold `scripts/move-ticket.mjs` in their repo: map status → tracker column/section ID, find the task by the ticket-ID naming convention, move it via the tracker's API (token from env/.env — never hardcode), print ONE line (it becomes the Obsidian notice). Statuses without a tracker column: print a skip message, exit 0. **Windows: never `process.exit()` after async work** (libuv teardown race → false failures) — set `process.exitCode` and return. A `--dry-run` flag makes it testable. Add a `set` rule for completion stamping too: `{ "when": ["Done"], "set": { "done": "{{date}}" } }` — it feeds the milestone velocity forecast (completedProperty).
Decide with the user which side is the **source of truth** (recommend: the vault; tracker follows) and write that down in their project docs. Then enable *automation commands on this device*.

## 6 · Run-lifecycle hooks (Claude Code)

So board cards show started → running ⇄ waiting → done and completed runs log back into the note:
1. Scaffold `scripts/dispatch-run-state.mjs` in their repo: appends `{id, state, ts}` to `$DISPATCH_RUNS_FILE`; on `done` also appends a run-log line + final-assistant-message excerpt (from the hook's stdin `transcript_path`) to the note at `$DISPATCH_NOTE` under `## Dispatch runs`. Silent no-op when `DISPATCH_RUN_ID` is unset. (The Dispatch README describes the contract; a reference implementation lives in the plugin repo history.)
2. Wire `.claude/settings.json` hooks: `SessionStart`→running, `UserPromptSubmit`→running, `Stop`→waiting, `SessionEnd`→done.
3. Semantics to explain: **done fires when the claude process exits** (`/exit`), not when it finishes answering — that's what `waiting` is for. Ghost badges (killed terminals) are cleared via badge-click → menu.

## 7 · Smoke test (walk the user through, verify each)

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
