# CLAUDE.md

Dispatch is an Obsidian plugin (TypeScript, esbuild, Obsidian plugin API): a
property-driven kanban board plus "chip" buttons that launch AI coding agents
(Claude Code, Codex, …) with a prompt.

## Commands

```bash
npm install
npm run dev     # watch build → main.js (inline sourcemap)
npm run build   # tsc type-check + production build
```

No test suite yet. `npm run build` is the minimum verification for every change.

## Architecture

- `src/main.ts` — plugin entry; loads/saves both settings layers, registers view/command/processor/settings tab
- `src/settings.ts` — settings model. **Two layers, keep them separate:**
  - `SharedSettings` → `data.json` (syncs with the vault; must NEVER contain absolute paths — repos are referenced by alias)
  - `LocalSettings` → `~/.dispatch/<vault>-<pathhash>.json`, OUTSIDE the vault (machine-specific: alias→path map, tool command templates, opt-in toggles). Never store it in the vault — vault sync (Drive/git/Obsidian Sync) would leak paths and let team members overwrite each other; a legacy in-vault `local.json` is auto-migrated out and deleted
- `src/board.ts` — `BoardView` (ItemView) with two tabs. **Status**: groups notes by the status property, HTML5 drag & drop writes status via `app.fileManager.processFrontMatter`, optional post-drop hook command; in-column order = numeric rank frontmatter property (gap-based, RANK_GAP=1024, midpoint insert, renormalize on collision — steady state writes only the moved note). **Milestones**: groups by the version property normalized to major.minor (`versionKey`), drops write the canonical planned-version value (never rewrite same-column raw values), header shows editable tag (shared settings, keyed by major.minor) + weighted progress Σ(size × status progress)/Σ(size); no manual ordering on this tab, drops never touch status/rank; the post-drop hook fires for status changes only
- `src/chips.ts` — ` ```dispatch ` code-block processor rendering chip buttons + `launchChip()` shared by block chips and virtual chip templates (settings-defined, rendered via card context menu and file-menu — computed from frontmatter, never stored in notes); chips reference tools/repos by name only (security boundary: note content must never carry commands or paths). Board automations: per-column rules with frontmatter `set` (applied atomically with the status write) and commands (gated per device via `enableHooks`); legacy single postDropHook is migrated into the rules list on load
- `src/exec.ts` — template substitution, arg quoting, process spawning (chips detach; hooks run to completion and report via Notice)
- `src/node.ts` — the typed edge of the Node API (companion to `src/vault.ts` for Obsidian's untyped frontmatter)
- `src/runs.ts` — `RunTracker`: chip-run lifecycle OBSERVER (never a process supervisor). Launch records appended by the plugin, `running`/`done` appended by the launched agent's lifecycle hooks via `DISPATCH_*` env vars; JSONL at `~/.dispatch/runs/<vault>-<hash>.jsonl` (machine-local, fs.watch → board badges). Durable run-log lines are appended to the note by the hook script, not the plugin
- Board extras: WIP limits (columns 4th segment), slice-by bar (badge properties), keyboard nav (arrows/Enter/`[`/`]`), velocity forecast (completedProperty dates within velocityWindowDays; renders nothing without data)

## Invariants

- Notes and SharedSettings are team-synced data: no absolute paths, no raw commands in either.
- Prompts from notes are always inserted as quoted arguments — never add a `{{promptRaw}}` variable.
- Hooks/chips execute commands only from LocalSettings (or the shared hook command gated by the per-device `enableHooks` toggle).
- **The settings tab renders through `display()`, and `DispatchSettingTab` must not implement
  `getSettingDefinitions()`.** Obsidian 1.13+ renders the tab from those definitions and stops
  calling `display()` as soon as the array is non-empty, so definitions carrying only name/desc
  turn every row into a label with no input — the tab shipped read-only that way in 0.2.3. This
  leaves Dispatch out of the 1.13+ settings search and keeps
  `obsidianmd/settings-tab/prefer-setting-definitions` warning: accepted, not an oversight.
  Adopting the API means porting all 37 rows to `control`/`render` definitions **and** raising
  `minAppVersion` to 1.13 (ADR-0017) — one change, never a partial one.
- `isDesktopOnly: true` — Node APIs (`child_process`, `fs`, `os`, `path`, `process`) are allowed, but
  **every one of them is imported in `src/node.ts` and nowhere else.** That module asserts them into
  hand-written signatures, because the community-directory review type-checks this plugin without
  `@types/node`: importing `fs` anywhere else turns its values into `any` there and puts unsafe-any
  warnings on the public listing. `npm run lint:review` reproduces that environment — a finding
  outside `src/node.ts` means the boundary was bypassed. The assertions skip real type-checking, so
  `test/node.test.ts` compares the boundary's behaviour against the real modules.

## The project wiki (`docs/`)

The repo dogfoods its own plugin: `docs/` is an Obsidian vault (git-ignored, along with
`docs/.obsidian`), and `docs/wiki/` holds the project's tickets, ADRs and release notes.
Board config: `docs/.obsidian/plugins/dispatch/data.json`; this machine's paths and tool
commands: `~/.dispatch/docs-e7f737f3.json`. The plugin files in
`docs/.obsidian/plugins/dispatch/` are a **copy**, not a symlink — run `npm run install:docs`
after `npm run build` to test a change on this board. (A symlink would point the vault at the
repo that contains it, and would share one `data.json` with the other vault. The live symlinked
dev install is that other vault; the repo-root `data.json` belongs to it, not to this one.)

- **Tickets** `docs/wiki/05_Requirements/Tickets` — columns `Backlog → In progress → Review → Done`,
  plus `Rejected` (excluded from progress). Templates in `docs/wiki/00_Start-Here/Templates`.
- **Workflow commands** `.claude/commands/*.md`, launched from card chips as `/refine US00042`.
  Process lives in the repo, state lives in the wiki — never the other way round.
- **Tracker** GitHub Issues. A ticket links to its issue through `discussion:`;
  `scripts/dispatch/move-ticket.mjs` reads that property on drag. Only `Done`/`Rejected` have a
  GitHub counterpart (close/close-not-planned) — the rest just mean "open".

### Workflow invariants

- **Board automations fire on a board drag, not on frontmatter an agent writes.** A command that
  sets `status: Done` itself must also stamp `completed:` and update the GitHub issue, or the
  velocity forecast and the tracker silently drift.
- **The ticket freeze.** Once a ticket leaves `In progress`, its contract zone (goal/symptom,
  acceptance criteria, open questions, scope, implementation plan) is read-only; stamp `frozen:`.
  New information goes to the record zone as a dated entry; a wrong frozen statement gets an
  annotation (`> ⚠️ Correction <date>: …`) beneath it, never a rewrite; new scope becomes a new
  linked ticket. A spec that can change after the code was built against it makes every later
  spec↔code mismatch unexplainable.
- **Gates are gates.** `open_questions: 0` before development starts, `open_tests: 0` before a
  ticket leaves `Review`. No command crosses a gated boundary on its own. This board has no
  refinement column — the counters *are* the gate.
- **Ownership.** Every page carries `owner:`, a person resolving to `docs/wiki/00_Start-Here/Team/`,
  never a team. A derived page also carries `derived_from:` and `maintained_by:`, and a command
  that creates one must register its refresh — if no recurring job owns it, it may not create it.
- **Precedence.** ADRs in `docs/wiki/07_Engineering/Decisions` outrank ticket prose; ticket prose
  outranks a stale wiki page; the code outranks any claim about the code. On a wiki ↔ GitHub
  disagreement the **wiki wins** — the issue is a mirror, not the source of truth.
- **Never name a person in a command.** Attribution resolves at runtime from `assignee:`, `owner:`,
  and `todos.assignees` — a hardcoded name books the whole team's work to one person.
- **Name the session after the ticket: `<ID> - <shortened title>`.** As soon as a conversation is
  identifiably about one ticket — a chip firing `/refine US00042`, or just "what's left on
  BUG00007?" — set the session title to e.g. `US00042 - Import Meet transcripts`, via
  `set_session_title` with `session_id: "self"`. Do it when the ID becomes known, not at the end:
  the point is finding the session again in a list of twenty, and a session named at the end was
  unfindable for its whole life. The second half is a *shortened* title — a few words, no repeated
  ID, no `Story -`/`Bug -` prefix, not a copy of the note's filename. If a conversation turns out
  to be about a different ticket, rename it; if it spans several, name it for the one that owns the
  work; if it is about no ticket at all, leave it alone.

## Releasing

Bump with `npm version patch|minor|major` (updates manifest.json + versions.json
via version-bump.mjs), push the tag — `.github/workflows/release.yml` builds and
drafts a GitHub release with `main.js`, `manifest.json`, `styles.css`. Publishing
the draft stays manual (ADR-0018).

- **Every release note carries a `## GitHub release body` section**, fenced so it copies
  verbatim. The wiki is git-ignored, so that block may contain **no `[[wikilink]]` and no
  `docs/wiki/…` path** — both are dead on GitHub. Tickets are referenced by their
  `discussion:` issue URL, past releases by `…/releases/tag/<version>`, and ADRs are stated
  in prose rather than linked, because ADRs are not published. Written by `/release` step 8.
