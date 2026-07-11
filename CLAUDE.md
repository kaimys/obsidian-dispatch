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
  - `LocalSettings` → `local.json` (machine-specific: alias→path map, tool command templates, opt-in toggles; users exclude it from sync)
- `src/board.ts` — `BoardView` (ItemView): scans configured folders, groups notes by a frontmatter property, HTML5 drag & drop, writes status via `app.fileManager.processFrontMatter`, optional post-drop hook command
- `src/chips.ts` — ` ```dispatch ` code-block processor rendering chip buttons; chips reference tools/repos by name only (security boundary: note content must never carry commands or paths)
- `src/exec.ts` — template substitution, arg quoting, process spawning (chips detach; hooks run to completion and report via Notice)

## Invariants

- Notes and SharedSettings are team-synced data: no absolute paths, no raw commands in either.
- Prompts from notes are always inserted as quoted arguments — never add a `{{promptRaw}}` variable.
- Hooks/chips execute commands only from LocalSettings (or the shared hook command gated by the per-device `enableHooks` toggle).
- `isDesktopOnly: true` — Node APIs (`child_process`, `fs`, `os`) are allowed, but only via `src/exec.ts`.

## Releasing

Bump with `npm version patch|minor|major` (updates manifest.json + versions.json
via version-bump.mjs), push the tag — `.github/workflows/release.yml` builds and
drafts a GitHub release with `main.js`, `manifest.json`, `styles.css`.
