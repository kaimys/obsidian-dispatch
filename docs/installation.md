# Installation & configuration

Desktop only — chips and automations spawn local processes.

## Install

Not yet in the community plugin directory. Until then:

1. Download `main.js`, `manifest.json` and `styles.css` from a release (or build from source: `npm install && npm run build`).
2. Copy them into `<vault>/.obsidian/plugins/dispatch/`.
3. Enable **Dispatch** in *Settings → Community plugins*.

Or install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) with this repository's URL.

### Guided setup

Integrating Dispatch into a project — boards, device config, chips, tracker sync, agent hooks — is itself agent-guided. In [Claude Code](https://claude.com/claude-code):

```
/plugin marketplace add kaimys/obsidian-dispatch
/plugin install dispatch-setup
```

Then say "set up Dispatch for this project" in your repo. The skill scans an existing vault (ticket folders, status vocabulary, frontmatter fill rates) and turns the interview into a confirmation of pre-filled suggestions — or scaffolds a [wiki structure](wiki-structure.md) if there isn't one yet, and proposes the [workflow skills](skills.md) for your code repo.

No Claude Code? The skill is a plain markdown checklist: `plugins/dispatch-setup/skills/dispatch-setup/SKILL.md`.

## The two configuration layers

Dispatch splits its settings so a vault can be shared across a team without leaking machine-specific paths:

| Layer | Stored in | Synced? | Contains |
| --- | --- | --- | --- |
| **Shared** | `data.json` (normal plugin settings) | yes, with the vault | folders, properties, columns, chip templates, automation rules, default tool |
| **This device** | `~/.dispatch/<vault>-<hash>.json` (user profile, **outside the vault**) | never | repo alias → absolute path, tool command templates, calendar URL, opt-in toggles |

Notes and shared settings never contain absolute paths. They reference repositories by **alias** (e.g. `my-project`), and each team member maps that alias to a local path once in *Settings → Dispatch → This device*.

Because the device layer lives outside the vault (Windows: `%USERPROFILE%\.dispatch\`), it works with **any** sync — Obsidian Sync, Google Drive, git — without exclusion rules, and teammates can never overwrite each other's device config. The exact path is shown in the settings tab. A `local.json` from older versions found next to the plugin is migrated there and removed from the vault automatically.

## Board settings

- **Source folders** — vault folders scanned for cards (one per line)
- **Status property** — the frontmatter property holding the column value (default `status`)
- **Order property** — where the manual position within a column is stored (default `rank`; empty disables manual ordering)
- **Columns** — ordered, one per line. Four segments: `value | Display label | progress | WIP limit`
  - *progress* (0–100) is the weight used by the Release Plan's progress bar; `-` excludes the status entirely (e.g. Rejected)
  - *WIP limit* makes the header show `count/limit` and outlines the column amber at the limit, red above
  - Statuses found in notes but not configured appear as extra columns at the end
- **Title / badge properties** — what each card shows (e.g. `id` as title prefix, `priority` and `type` as badges)
- **Assignee property** — shown as an accent-outlined `@Name` badge, always first in the slice-by bar
- **Open-questions property** — numeric counter rendered as the `? N` badge (amber → green at 0)
- **Open-tests property** — numeric counter rendered as the `✓ N` badge (purple → green at 0)
- **Discussion property** — a thread URL rendered as a chat icon in the card title
- **Required properties** — drives the ⚠ problems panel (typically `id, status, updated`)

**Milestones** (the Release Plan tab): version property, planned versions, per-version tags, size property, completed property, velocity look-back window, release-notes folder.

**Meetings** and **Todos**: the meetings folder (root only), calendar filter and look-ahead; the todo folders, allowlisted section names, the assignee list and the fallback owner. Each tab appears once its folder is configured.

## Chips

Chips launch an agent (or any CLI) with a templated prompt, in the right repository. Two forms:

**Virtual chips** — recommended for recurring workflows. Defined once in settings as `label | tool | repo | prompt`, they appear on every card's right-click menu and in the note's file menu. Nothing to paste into notes, and a regenerated document can't lose them:

```
Refine              | claude | my-project | /refine {{id}}
Update ticket       | claude | my-project | /update-ticket {{id}}
Implementation plan | claude | my-project | /implementation-plan {{id}}
```

Variables: `{{id}}`, `{{status}}`, `{{file}}`, `{{title}}`. Column-header chips add `{{ids}}`, `{{status}}`, `{{count}}` for batch runs; meeting and calendar chips add `{{date}}` and `{{title}}`.

**Block chips** — for one-offs and generated reports. A fenced block anywhere in a note, carrying **no commands and no paths** — only a prompt, a tool name and a repo alias:

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

- `prompt` (required) — supports `{{file}}` (vault-relative path), `{{title}}` (basename), `{{vault}}` (vault path on this machine)
- `tool` (optional) — defaults to the shared *Default tool*
- `repo` (optional) — working-directory alias; defaults to the vault folder
- `label` (optional) — button text

A chip refuses to launch when a variable it references is empty — a ticket with no `id` would otherwise send a bare `/refine` to an agent.

### Tool commands

Tools are defined **per device** as command templates:

```
claude = start "Dispatch" /d {{cwd}} cmd /k claude {{prompt}}
codex  = start "Dispatch" /d {{cwd}} cmd /k codex {{prompt}}
```

macOS:

```
claude = osascript -e 'tell app "Terminal" to do script "cd " & quoted form of {{cwd}} & " && claude " & quoted form of {{prompt}}'
```

Variables: `{{cwd}}`, `{{prompt}}`, `{{promptFile}}` (the prompt written to a temp file — use it for long or multiline prompts). All expand as quoted arguments; append `Raw` for unquoted (there is deliberately **no** `{{promptRaw}}`).

> **Windows:** avoid launching through `wt.exe` directly — Windows Terminal parses `;` in its command line as a *tab separator even inside quotes*, so any prompt containing a semicolon breaks. `start` opens the user's default terminal (usually Windows Terminal anyway) without that parsing.

### Run lifecycle

When a chip launches a tool, Dispatch records the run in a machine-local file (`~/.dispatch/runs/…jsonl`) and passes `DISPATCH_RUN_ID`, `DISPATCH_RUNS_FILE`, `DISPATCH_NOTE`, `DISPATCH_LABEL` and `DISPATCH_STARTED` into the process.

Lifecycle hooks in the target repo — Claude Code `SessionStart`/`Stop`/`SessionEnd` hooks calling a three-line script — append records back. The board then shows a live badge on the card: **started → running ⇄ waiting → done**, where *waiting* means the agent finished its turn and the session needs you. Done fades after 24 h; clicking a badge clears a ghost run. On completion the hook appends a run-log line to the note's `## Dispatch runs` section.

The plugin only *observes*: live state stays on the machine running the agent, durable outcomes land in the note and sync with the vault.

**One agent per working tree.** Launching a chip into a repo that already has an active run offers **Queue** (starts when the blocking session ends), **Run anyway**, or cancel. The queue is in-memory; staleness caps (2 h launched, 24 h running) keep a killed terminal from blocking a repo forever. In a monorepo, define one alias per package if you want parallel sessions.

## Automations

Rules evaluated when a card **enters a column** (settings → Automations, JSON):

```json
[
  { "when": ["Deployed"], "set": { "deployed": "{{date}}" }, "repo": "", "command": "" },
  { "when": [], "set": {},
    "repo": "my-project",
    "command": "node scripts/move-ticket.mjs {{file}} {{from}} {{to}}" }
]
```

- `when` — statuses that trigger the rule; empty = every status change.
- `set` — frontmatter assignments written **atomically with the status change** (`{{date}}`, `{{datetime}}`, `{{from}}`, `{{to}}`). This is how `deployed:` gets stamped, which in turn feeds the release forecast.
- `command` — optional shell command run in the `repo` alias, e.g. to mirror the move into your tracker. Variables: `{{file}}`, `{{from}}`, `{{to}}`, `{{cwd}}` (quoted; append `Raw` for unquoted). Commands are **shared** config but run only on devices that opt in (*This device → Enable automation commands*); `set` assignments always apply.

## Security model

Vault content is data, not code. Because notes sync across a team, Dispatch is built so that a note can never execute an arbitrary command:

- Chip blocks only *reference* tools and repos by name; the actual commands and paths live in device-local settings.
- Prompts are inserted as a single quoted argument (quotes and backslashes escaped, newlines flattened). For untrusted vaults, prefer `{{promptFile}}` in your tool templates.
- Every chip click shows a confirmation dialog with the exact command by default; automation commands are off per device until enabled.

Caveat: commands run through your system shell. On Windows (`cmd.exe`), `%VAR%` sequences inside arguments are still expanded by the shell — another reason to keep the confirmation dialog on in shared vaults.

### Disclosures

- **Executes local processes** — but only commands *you* configure on *your* device. Note content can never introduce a command; the confirmation dialog is on by default.
- **Reads/writes outside the vault** — device settings at `~/.dispatch/<vault>-<hash>.json` and run records at `~/.dispatch/runs/…jsonl`, deliberately outside the vault so machine paths never sync.
- **One network request type** — if (and only if) you configure a calendar ICS URL, the plugin fetches that feed read-only (cached 15 min) for the Meetings tab. Nothing else leaves your machine; no telemetry. Commands you configure act under your own credentials.

## Building from source

```bash
npm install
npm run dev     # watch build (main.js with inline sourcemap)
npm run build   # type-check + production build
```

Symlink or copy the repo folder into a test vault's `.obsidian/plugins/dispatch/`, then use Obsidian's "Reload app without saving" command after a build.
