# Dispatch

An [Obsidian](https://obsidian.md) plugin for teams who run their workflow out of their vault:

- **Board** — a kanban board driven by note properties. Cards are notes; columns come from a frontmatter property (e.g. `status`). Drag a card to another column and the property updates immediately via Obsidian's frontmatter API.
- **Chips** — buttons embedded in notes that dispatch a prompt to an AI coding agent (Claude Code, Codex, or any CLI you configure) in the right repository.

Desktop only (chips and hooks spawn local processes).

## Team-safe configuration model

Dispatch splits its configuration into two layers so a vault can be shared across a team without leaking machine-specific paths:

| Layer | Stored in | Synced? | Contains |
| --- | --- | --- | --- |
| **Shared** | `data.json` (normal plugin settings) | yes, with the vault | folders, status property, columns, hook command, default tool |
| **This device** | `local.json` (next to the plugin) | **no — exclude it from sync/git** | repo alias → absolute path, tool command templates, opt-in toggles |

Notes and shared settings never contain absolute paths. They reference repositories by **alias** (e.g. `my-project`), and each team member maps that alias to a local path once in *Settings → Dispatch → This device*.

> **Important:** add `.obsidian/plugins/dispatch/local.json` to your vault's sync exclusions (Obsidian Sync "Excluded files", or `.gitignore` for git-synced vaults).

## Board

Configure in *Settings → Dispatch*:

- **Source folders** — vault folders scanned for cards (one per line)
- **Status property** — the frontmatter property that holds the column value (default `status`)
- **Order property** — the frontmatter property that holds the manual sort position within a column (default `rank`; empty disables manual ordering)
- **Columns** — ordered list, one per line (`value` or `value | Display label`). Statuses found in notes but not configured appear as extra columns at the end.
- **Title / badge properties** — what each card shows (e.g. ticket `id` as title prefix, `priority` and `type` as badges)

Open the board via the ribbon icon or the command *Dispatch: Open board*. Click a card to open the note; drag it to a column to change its status, or within a column to change its position (typically used as a priority order).

### Sort order within a column

Card order is data, so it lives in the notes and syncs with the vault: dropping a card writes a numeric position into the order property. Ranks are assigned with gaps (1024 apart) and inserts take the midpoint, so a reorder normally rewrites **only the moved note**. When a column contains unranked cards or a gap is exhausted, the whole column is renormalized once (only notes whose value changes are written). Cards without a rank sort below ranked ones, alphabetically.

## Milestones

The board has two tabs — **Kanban** (status columns) and **Milestones** — a roadmap view where columns are target versions and dragging a card between columns updates the version property immediately.

- Non-version values ("Rejected", "Icebox") become **special columns on the far left**, in their *Planned versions* order. Version columns are keyed by **major.minor**: `v1.2.0`, `1.2.0` and `1.2.1` all group into the column `1.2`, so inconsistent formatting doesn't split a milestone. Dropping writes the canonical value from *Planned versions* (or the plain `major.minor` for auto-discovered columns); dropping on *(no version)* removes the property.
- **Planned versions** (settings) are always shown, even when empty — that's how you plan a future release before any ticket is assigned.
- Each version can carry one **tag** ("MVP", "Closed Beta", …) — click the tag chip in the column header to edit it; tags are shared settings, keyed by `major.minor`.
- The header shows a **progress bar**: `Σ(size × status progress) / Σ(size)`. Status progress comes from the third segment of the *Columns* setting (e.g. `Development | | 55`, `Done | | 100`, `Rejected | | -` to exclude); size comes from a numeric frontmatter property (default `size`, missing = 1).
- Within a version column, cards sort by workflow progress (status order, then rank) — there is no manual ordering on this tab, and drops only change the version, never status or rank.

### Post-drop hook

Optionally run a command after every successful drop — e.g. to mirror the move into Asana, Jira, or Linear. The hook is **shared** (the command is part of the team workflow) but runs only on devices that opt in (*This device → Enable post-drop hook*), and it executes inside a repo alias:

```
Hook repository alias: my-project
Hook command:          node scripts/move-ticket.mjs {{file}} {{from}} {{to}}
```

Variables: `{{file}}` (vault-relative note path), `{{from}}`, `{{to}}` (old/new status), `{{cwd}}` (resolved repo path). All are expanded as quoted arguments; append `Raw` for the unquoted value (e.g. `{{cwdRaw}}`).

## Chips

A chip is a fenced code block. It carries **no commands and no paths** — only a prompt, a tool name, and a repo alias:

````markdown
```dispatch
label: Refine this ticket
tool: claude
repo: my-project
prompt: |
  Refine {{file}}: read the spec, check open questions,
  and propose acceptance criteria.
```
````

- `prompt` (required) — supports `{{file}}` (vault-relative path of the note), `{{title}}` (note basename), `{{vault}}` (vault path on this machine)
- `tool` (optional) — defaults to the shared *Default tool*
- `repo` (optional) — working directory alias; defaults to the vault folder
- `label` (optional) — button text

Tools are defined per device as command templates:

```
claude = wt.exe -d {{cwd}} cmd /k claude {{prompt}}
codex  = wt.exe -d {{cwd}} cmd /k codex {{prompt}}
```

macOS example:

```
claude = osascript -e 'tell app "Terminal" to do script "cd " & quoted form of {{cwd}} & " && claude " & quoted form of {{prompt}}'
```

Template variables: `{{cwd}}`, `{{prompt}}`, `{{promptFile}}` (prompt written to a temp file — use it for long/multiline prompts). All are expanded as quoted arguments; append `Raw` for unquoted (there is deliberately **no** `{{promptRaw}}`).

## Security model

Vault content is data, not code. Because notes sync across a team, Dispatch is designed so that a note can never execute an arbitrary command:

- Chip blocks only *reference* tools and repos by name; the actual commands and paths live in your device-local settings.
- Prompts are inserted as a single quoted argument (quotes/backslashes escaped, newlines flattened). For fully untrusted vaults, prefer `{{promptFile}}` in your tool templates.
- By default every chip click shows a confirmation dialog with the exact command; the post-drop hook is off per device until you enable it.

Caveat: commands run through your system shell. On Windows (`cmd.exe`), `%VAR%` sequences inside arguments are still expanded by the shell — another reason to keep the confirmation dialog on in shared vaults.

## Installation

Not yet in the community plugin directory. Until then:

1. Download `main.js`, `manifest.json`, `styles.css` from a release (or build from source: `npm install && npm run build`).
2. Copy them to `<vault>/.obsidian/plugins/dispatch/`.
3. Enable **Dispatch** in *Settings → Community plugins*.

Or install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) with this repository's URL.

## Development

```bash
npm install
npm run dev     # watch build (main.js with inline sourcemap)
npm run build   # type-check + production build
```

Symlink or copy the repo folder into a test vault's `.obsidian/plugins/dispatch/` and use the "Reload app without saving" command after builds.

## Roadmap

- Multiple named boards
- Column WIP limits and colors
- Card filtering
- Milestone burndown over time
- Chip runs with inline output (headless mode) instead of opening a terminal

## License

[MIT](LICENSE)
