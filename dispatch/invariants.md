# Dispatch — project invariants

**This is the canonical file.** `CLAUDE.md` and `AGENTS.md` are pointers at it and carry only what
is specific to their own agent ([[ADR-0020]]). Everything below holds whichever agent is reading:
change it here, never in a copy.

Dispatch is an Obsidian plugin (TypeScript, esbuild, Obsidian plugin API): a
property-driven kanban board plus "chip" buttons that launch AI coding agents
(Claude Code, Codex, …) with a prompt.

## Commands

```bash
npm install
npm run dev     # watch build → main.js (inline sourcemap)
npm run build   # tsc type-check + production build
```

```bash
npm run lint    # Obsidian's own plugin ruleset
npm test        # vitest
```

`npm run build && npm run lint && npm test` is the minimum verification for every change.

## Architecture

- `src/main.ts` — plugin entry; loads/saves both settings layers, registers view/command/processor/settings tab
- `src/settings.ts` — settings model. **Two layers, keep them separate:**
  - `SharedSettings` → `data.json` (syncs with the vault; must NEVER contain absolute paths — repos are referenced by alias)
  - `LocalSettings` → `~/.dispatch/<vault>-<pathhash>.json`, OUTSIDE the vault (machine-specific: alias→path map, tool command templates, opt-in toggles). Never store it in the vault — vault sync (Drive/git/Obsidian Sync) would leak paths and let team members overwrite each other; a legacy in-vault `local.json` is auto-migrated out and deleted
- `src/board.ts` — `BoardView` (ItemView) with two tabs. **Status**: groups notes by the status property, HTML5 drag & drop writes status via `app.fileManager.processFrontMatter`, optional post-drop hook command; in-column order = numeric rank frontmatter property (gap-based, RANK_GAP=1024, midpoint insert, renormalize on collision — steady state writes only the moved note; the maths is `planRankInsert` in `src/moves.ts`, shared by every ordering write). **Milestones**: groups by the version property normalized to major.minor (`versionKey`), a drop on a line writes its highest known patch across planned entries and non-archived cards as canonical `vMAJOR.MINOR.PATCH`, an expanded patch column writes its own patch, non-version labels write as listed (`src/milestones.ts`, ADR-0036; never rewrite same-column raw values), header shows editable tag (shared settings, keyed by major.minor) + weighted progress Σ(size × status progress)/Σ(size); drops never touch status or `rank`, and the post-drop hook fires for status changes only. **In-column order** is a second, independent property, `milestones.releaseOrderProperty` (e.g. `release_rank`; empty = off, and the column sorts status → rank → title as before): with it on, cards with a release rank sort first and override the status sort, the rest follow in the old order, and a drop lands next to the visible card it was dropped on (a `DropAnchor`, never an index, so a slice cannot shift it) — planned by `planReleaseDrop`, one patch per note, over the column's **ordering scope** (`orderingScope`: the whole line for a patch column; lines, labels and "(no version)" are ordered, the archive is not). A move without a position (keyboard, retarget merge) appends; a reorder is silent and runs no automation. Column membership is `inColumn`, shared by the board and the drop guard. A numeric line header's right-click "Retarget release…" moves every non-archived card of the line (all slices) to another line — planned in `src/retarget.ts` (ADR-0009): blocked entirely by any source card at progress ≥ 100, same-line targets refused, an existing target writes its ADR-0036 value, a new one `vMAJOR.MINOR.PATCH`; the planned entry and tag are renumbered (new target) or dropped (merge); notes are written before settings, and settings only when every note succeeded. With the release order on, a merge appends the source line after the target's cards. The same header offers "Copy release order to Kanban" when both order properties are set: planned in `src/release-order.ts`, it moves the line's open cards to the top of each Kanban status column in release order, writes `rank` only, and a second run writes nothing
- `src/retarget.ts` — the pure planner for a header retarget: every precondition checked before the first patch, one patch per card (version, plus the appended release rank on a merge), the new `plannedVersions`/`tags`
- `src/release-order.ts` — the pure planner for "Copy release order to Kanban": a one-way, one-time seed of `rank` from the release order
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
  Adopting the API means porting all 42 rows to `control`/`render` definitions **and** raising
  `minAppVersion` to 1.13 (ADR-0017) — one change, never a partial one.
- `isDesktopOnly: true` — Node APIs (`child_process`, `fs`, `os`, `path`, `process`) are allowed, but
  **every one of them is imported in `src/node.ts` and nowhere else.** That module asserts them into
  hand-written signatures, because the community-directory review type-checks this plugin without
  `@types/node`: importing `fs` anywhere else turns its values into `any` there and puts unsafe-any
  warnings on the public listing. `npm run lint:review` reproduces that environment — a finding
  outside `src/node.ts` means the boundary was bypassed. The assertions skip real type-checking, so
  `test/node.test.ts` compares the boundary's behaviour against the real modules.

## The Dispatch folder

`dispatch/` holds this project's **shared** Dispatch setup, and nothing else ([[ADR-0035]]). It
is named without a dot so it is never mistaken for the device-local `~/.dispatch/`.

- `workflow/` — one canonical file per workflow ([[ADR-0020]]).
- `wiki` — the git-ignored, repo-relative link to the vault ([[ADR-0029]]).
- `scripts/` — the repo-side scripts: `move-ticket`, `run-state`, `meet-fetch`, `lint-vault`
  ([[ADR-0027]] decides who configures each).
- `invariants.md` — this file.
- `settings.yaml` — **project-level settings**: committed, read by agents, true for the project
  whoever checks it out. Today it holds only `tracker.repository`. The vault's `data.json` stays
  the board's configuration, and `~/.dispatch/` stays the device's.

**Never in it:** device-local configuration and run state (they stay in `~/.dispatch/`), secrets,
absolute paths, and the `dispatch-setup` plugin, which a project installs rather than vendors.
**The page templates stay in the vault**, because Obsidian's Templates core plugin can only read
a folder inside it. **The ADRs join the folder** when US00032 moves them into the repo.

A checkout without the `dispatch/wiki` link cannot reach the vault. Create it once per checkout
and worktree, since git does not carry it: `New-Item -ItemType Junction -Path dispatch\wiki
-Target <vault>` on Windows, `ln -s <vault> dispatch/wiki` elsewhere.

## The project wiki

The repo dogfoods its own plugin. `docs/` holds only the plugin's published documentation
(`overview.md`, `installation.md`, `page-types.md`, `skills.md`, `wiki-structure.md`, `assets/`).
The project's tickets, ADRs and release notes live in their own Obsidian vault, `Dispatch-Wiki`,
synced via Google Drive and reached from this repo through `dispatch/wiki` — a git-ignored,
repo-relative symlink ([[ADR-0029]]; `git ls-files dispatch/wiki` is empty). `dispatch/wiki/`
holds `00_Start-Here/`, `05_Requirements/`, `07_Engineering/`, `.obsidian/` etc. directly, with
no extra folder level in between.

Board config: `dispatch/wiki/.obsidian/plugins/dispatch/data.json`; this machine's paths and tool
commands: `~/.dispatch/<vault name>-<hash>.json` (`src/main.ts:186` derives the exact name — see
that file rather than hardcoding it here, since it is machine- and vault-specific). The plugin
files in `dispatch/wiki/.obsidian/plugins/dispatch/` are a **copy**, not a symlink — run `npm run deploy`
(build + copy; `npm run install:wiki` copies an existing build alone) to test a change on this
board. A symlink there would share one `data.json` with whatever other vault it also pointed at:
Obsidian writes a plugin's `data.json` beside its `main.js`, so two vaults linked to the same
checkout silently share one board's configuration ([[ADR-0026]]).

- **Tickets** `dispatch/wiki/05_Requirements/Tickets` — columns
  `Backlog → Refinement → In progress → Review → Done → Released`, plus `Rejected` (excluded from
  progress). **`Done` and `Released` both carry `progress: 100`, and only `Done` stamps
  `completed:`** — so the forecast measures throughput rather than release cadence. `Released` is
  *not* excluded, and the distinction is load-bearing: `excluded` means *not part of this version*
  (`Rejected`), which drops the card from the progress bar's denominator as well as its numerator.
  On a finished card that is subtractive — shipping a ticket would make its line read *less*
  complete. It buys nothing in exchange, because a card at `progress: 100` already contributes zero
  remaining weight to the release estimate (`src/board.ts:546`), which is the only thing the
  exclusion was ever wanted for. **`Done` and `Released`
  are not the same claim**: `Done` is the human's drag once a test plan is signed off, `Released`
  is what `/release` writes once a version carrying the ticket has actually shipped.
  Templates in `dispatch/wiki/00_Start-Here/Templates`.
- **Ticket ids** are 5 digits behind a prefix matching `type:` — `US` story, `BUG` bug,
  `SEC` security — and **each prefix numbers independently** (`SEC00001` exists while `US` is
  in the teens). Nothing parses the shape: the board renders `id` through `titleProperty` and
  `move-ticket.mjs` reads it as an opaque string, so a new prefix costs one line here and one in
  `create-ticket.md`. The note is `<Type> - <ID> - <Short name>.md`.
- **Workflow commands** `dispatch/workflow/*.md` — one canonical file per workflow, launched from
  card chips as `/refine US00042` (Claude) or `$refine US00042` (Codex). Each agent has a **stub**
  that points at the canonical file and carries no steps: `.claude/commands/<name>.md`,
  `.codex/skills/<name>/SKILL.md` ([[ADR-0020]]). Edit the canonical file; a step written into a
  stub is a step the other agent never sees. Process lives in the repo, state lives in the wiki —
  never the other way round. The templated starter set in
  `plugins/dispatch-setup/skills/dispatch-setup/assets/commands/` is a *different artifact* — the
  seed a fresh project is scaffolded from — and is deliberately not governed by this rule.
- **Tracker** GitHub Issues. A ticket links to its issue through `discussion:`;
  `dispatch/scripts/move-ticket.mjs` reads that property on drag. Only `Released`/`Rejected` have a
  GitHub counterpart (close/close-not-planned) — the rest, `Done` included, just mean "open",
  because closed on GitHub means shipped. The same script
  mirrors `version_target` onto the issue as a **GitHub milestone** of the same name, creating
  it on first use: per patch version (not per major.minor line, so one board column can span
  several milestones), never with a due date, and an empty `version_target` skips the step
  rather than un-assigning. **It only runs on a status drag** — the Milestones tab writes
  `version_target` without firing automations — by a drag or by a header retarget of a whole
  line — so a card moved between version columns is not mirrored until its status next changes. Closing a milestone belongs to `/release`.

### Workflow invariants

- **Board automations fire on a board drag, not on frontmatter an agent writes.** A command that
  writes a status directly must replicate what that destination's drag would have fired — and only
  that piece: `Done` stamps `completed:` (the velocity forecast starves without it), `Released`
  updates the GitHub issue (the tracker drifts without it). Replicating the wrong half is its own
  bug: `completed:` invented at release time dates the forecast from the release rather than from
  the work.
- **The ticket freeze.** Once a ticket leaves `In progress`, its contract zone (goal/symptom,
  acceptance criteria, open questions, scope, implementation plan) is read-only; stamp `frozen:`.
  New information goes to the record zone as a dated entry; a wrong frozen statement gets an
  annotation (`> ⚠️ Correction <date>: …`) beneath it, never a rewrite; new scope becomes a new
  linked ticket. A spec that can change after the code was built against it makes every later
  spec↔code mismatch unexplainable.
- **Gates are gates.** `open_questions: 0` before development starts, `open_findings: 0` before
  `/test-plan` runs (the code review comes before the freeze), `open_tests: 0` before a ticket
  leaves `Review`. No command crosses a gated boundary on its own. `Refinement` is the
  column, but the counter is still the gate: a ticket sitting in `Refinement` with unanswered
  questions is not buildable, and moving the card does not make it so. **A gated `0` is an
  earned count**, never a default or a template seed: the section it counts has to show the
  count, including an explicit "none, because …". Where nothing has counted the property stays
  empty — empty is no statement, `0` is a claim that the gate is already met.
- **Small-bug shortcut (ADR-0030).** An explicitly invoked `/fix-bug` may omit the separate review session only for a known, small-blast-radius fix. It must create the durable ticket first, verify the reproduction and mechanical gates, record actual results, count remaining checks, freeze the finalized contract and stamp completion plus the tracker mirror. No outstanding questions or manual checks may remain. An omitted review leaves `open_findings` empty, never a fabricated `0`. Scope growth or a failed check stops before Done. Ordinary development and `/test-plan` keep their review gate; the shortcut does not invoke `/test-plan` with that gate unmet.
- **Portable vault lookup (ADR-0029).** A repository reaches its vault only through the
  git-ignored `dispatch/wiki` link, never an absolute path. That includes a project scaffolded by
  `dispatch-setup`: re-running setup on an older scaffold migrates it, and replaces an absolute
  vault path in its workflows with the link. Notes, shared settings and chip repo fields stay
  path-free.
- **Ownership.** Every page carries `owner:`, a person resolving to `dispatch/wiki/00_Start-Here/Team/`,
  never a team. A derived page also carries `derived_from:` and `maintained_by:`, and a command
  that creates one must register its refresh — if no recurring job owns it, it may not create it.
- **Precedence.** ADRs in `dispatch/wiki/07_Engineering/Decisions` outrank ticket prose; ticket prose
  outranks a stale wiki page; the code outranks any claim about the code. On a wiki ↔ GitHub
  disagreement the **wiki wins** — the issue is a mirror, not the source of truth.
- **`accepted` and `proposed` ADRs both bind planning; only `superseded` may be ignored.** A
  proposed decision is agreed but not yet built, so it constrains what may be *planned* even though
  the code does not reflect it yet — which also means a review must not report existing code as
  violating one. Contradicting either is a decision to reopen, not to work around.
- **Never name a person in a command.** Attribution resolves at runtime from `assignee:`, `owner:`,
  and `todos.assignees` — a hardcoded name books the whole team's work to one person.
- **Name the session after the ticket: `<ID> - <shortened title>`.** As soon as a conversation is
  identifiably about one ticket — a chip firing `/refine US00042`, or just "what's left on
  BUG00007?" — set the session title to e.g. `US00042 - Import Meet transcripts`, by whatever
  mechanism your agent offers (see its own file). Do it when the ID becomes known, not at the end:
  the point is finding the session again in a list of twenty, and a session named at the end was
  unfindable for its whole life. The second half is a *shortened* title — a few words, no repeated
  ID, no `Story -`/`Bug -` prefix, not a copy of the note's filename. If a conversation turns out
  to be about a different ticket, rename it; if it spans several, name it for the one that owns the
  work; if it is about no ticket at all, leave it alone.

## Releasing

**Two long-lived branches.** `develop` carries everything for the next minor version and is what
`/develop` cuts from and merges back into; `main` only moves when a version ships, so it is always
the code someone can install. `main` stays GitHub's default branch. A **patch** bypasses `develop`
entirely — its fix branch is cut from `main` and merges back into `main`, so `develop` never needs
freezing — and `main` is merged back into `develop` afterwards, or the fix is missing from the next
minor version.

Bump on the branch being released, **before** it merges (`npm version patch|minor|major
--no-git-tag-version` updates manifest.json + versions.json via version-bump.mjs; commit it
yourself). Merge into `main`, then tag `main`'s new tip and push the tag — in that order:
`.github/workflows/release.yml` triggers on any tag push with no branch filter and builds the draft
from the tagged tree, so a tag cut before the merge describes a tree `main` never held. It drafts a
GitHub release with `main.js`, `manifest.json`, `styles.css`. Publishing the draft stays manual
(ADR-0018).

- **Every release note carries a `## GitHub release body` section**, fenced so it copies
  verbatim. The wiki is git-ignored, so that block may contain **no `[[wikilink]]` and no
  `dispatch/wiki/…` path** — both are dead on GitHub. Tickets are referenced by their
  `discussion:` issue URL, past releases by `…/releases/tag/<version>`, and ADRs are stated
  in prose rather than linked, because ADRs are not published. Written by `/release` step 8.
