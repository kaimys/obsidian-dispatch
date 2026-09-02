# Installation & configuration

Desktop only — chips and automations spawn local processes.

## Install

Open *Settings → Community plugins → Browse* in Obsidian, search for **Dispatch**, then install and enable it. The [directory listing](https://community.obsidian.md/plugins/dispatch) is the same plugin.

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

Scripts Dispatch ships — currently the Meet transcript import — keep their settings in that same per-vault file rather than one of their own, under a `google` key. A script the *project* chooses, such as a tracker sync, is configured by the project and Dispatch never writes it.

The sections below describe both layers as the **settings UI** presents them. If you (or an agent) write the files directly, read [The config files on disk](#the-config-files-on-disk) — the stored JSON does not have the same shape as the UI's compact input forms.

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

Lifecycle hooks in the target repo — Claude Code `SessionStart`/`Stop`/`SessionEnd` hooks calling a small script — append records back. A ready-to-copy implementation ships with the setup plugin: [`plugins/dispatch-setup/skills/dispatch-setup/assets/run-state.mjs`](https://github.com/kaimys/obsidian-dispatch/blob/main/plugins/dispatch-setup/skills/dispatch-setup/assets/run-state.mjs) — drop it into the target repo (e.g. `scripts/dispatch/run-state.mjs`) and wire the four events in that repo's `.claude/settings.json`. The board then shows a live badge on the card: **started → running ⇄ waiting → done**, where *waiting* means the agent finished its turn and the session needs you. Done fades after 24 h; clicking a badge clears a ghost run. On completion the hook appends a run-log line to the note's `## Dispatch runs` section.

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

## The config files on disk

Everything in the settings tab is stored as JSON. The UI's compact forms — pipe-delimited column lines, `tool = command` lines — are **input conveniences**; on disk the shapes differ. This matters when an agent or a script writes the files directly. After editing either file outside Obsidian, click the board's ↻ reload button.

### `<vault>/.obsidian/plugins/dispatch/data.json` — shared

Missing keys fall back to the defaults in `src/settings.ts`, but writing the full object keeps the file readable and diffable:

```json
{
  "board": {
    "sourceFolders": ["05_Requirements/Tickets"],
    "statusProperty": "status",
    "orderProperty": "rank",
    "columns": [
      { "value": "draft", "label": "Draft", "progress": 0 },
      { "value": "Ready for Refinement", "progress": 20 },
      { "value": "Refinement", "progress": 44, "wip": 5 },
      { "value": "Ready for Dev", "progress": 55 },
      { "value": "Development", "progress": 63, "wip": 4 },
      { "value": "Ready for Review", "progress": 86, "wip": 8 },
      { "value": "Deployed", "progress": 100 },
      { "value": "Rejected", "excluded": true }
    ],
    "titleProperty": "id",
    "assigneeProperty": "assignee",
    "badgeProperties": ["type", "priority", "version_target"],
    "questionsProperty": "open_questions",
    "testsProperty": "open_tests",
    "discussionProperty": "discussion",
    "requiredProperties": ["id", "status", "updated"],
    "automations": [
      { "when": ["Deployed"], "set": { "deployed": "{{date}}" }, "repo": "", "command": "" },
      { "when": [], "set": {}, "repo": "my-app", "command": "node scripts/move-ticket.mjs {{file}} {{from}} {{to}}" }
    ]
  },
  "milestones": {
    "versionProperty": "version_target",
    "plannedVersions": ["v1.1.0", "v1.2.0", "v1.3.0"],
    "tags": { "1.2": "Beta" },
    "sizeProperty": "size",
    "completedProperty": "deployed",
    "velocityWindowDays": 28,
    "releaseNotesFolder": "08_Delivery-and-QA/Releases"
  },
  "meetings": {
    "folder": "09_Meetings",
    "dateProperty": "meeting_date",
    "participantsProperty": "participants",
    "actionsProperty": "open_actions",
    "templates": [
      { "label": "Write meeting report", "tool": "claude", "repo": "my-app", "prompt": "/meeting report {{title}}" }
    ],
    "calendarFilter": "",
    "calendarLookaheadDays": 14,
    "calendarChips": [
      { "label": "Prepare agenda", "tool": "claude", "repo": "my-app", "prompt": "/meeting agenda {{date}} {{title}}" }
    ]
  },
  "todos": {
    "folders": ["09_Meetings", "05_Requirements/Tickets"],
    "sections": ["Action items", "Open action items"],
    "assignees": ["Alex", "Robin"],
    "fallbackAssignee": "Team"
  },
  "chips": {
    "defaultTool": "claude",
    "templates": [
      { "label": "Start refinement", "tool": "claude", "repo": "my-app", "prompt": "/refine {{id}}" },
      { "label": "Start development", "tool": "claude", "repo": "my-app", "prompt": "/develop {{id}}" }
    ],
    "columnTemplates": [
      { "label": "Refine all tickets", "tool": "claude", "repo": "my-app", "prompt": "Work through these tickets sequentially with the full /refine workflow: {{ids}}." }
    ]
  }
}
```

Where the stored shape differs from the settings UI:

- **Columns are objects, not `value | Label | progress | WIP` strings.** `label` may be omitted (the `value` is then displayed), an omitted `wip` means no limit, and the UI's `-` progress becomes `"excluded": true` — *not* `"progress": "-"`.
- **`chips.templates` and `chips.columnTemplates` are separate lists** — card chips vs. batch chips on a column header. Identical object shape (`label`, `tool`, `repo`, `prompt`); only the column prompts get `{{ids}}`, `{{status}}` and `{{count}}`.
- **Empty means off, and hides the tab.** `meetings.folder: ""` hides the Meetings tab, `todos.folders: []` hides Todos, `milestones.completedProperty: ""` turns the forecast off, `board.orderProperty: ""` disables manual ordering, and an empty `assigneeProperty`/`questionsProperty`/`testsProperty`/`discussionProperty` drops that badge.
- **`milestones.tags` is keyed by normalized `major.minor`** (`"1.2": "Beta"`), while `plannedVersions` holds the canonical *write* form (`"v1.2.0"`) — dropping a card writes that exact string.
- **Automation rules always carry all four keys.** A `set`-only rule keeps `"repo": ""` and `"command": ""`; an empty `when` means every status change.

### `~/.dispatch/<vault>-<hash>.json` — this device

```json
{
  "repos": {
    "my-app": "C:\\Users\\me\\Workspace\\my-app"
  },
  "tools": {
    "claude": { "command": "start \"Dispatch\" /d {{cwd}} cmd /k claude {{prompt}}" },
    "codex": { "command": "start \"Dispatch\" /d {{cwd}} cmd /k codex {{prompt}}" }
  },
  "calendarUrl": "",
  "enableHooks": false,
  "confirmBeforeRun": true
}
```

- **`tools` maps a name to an *object*, not to a string** — `{"claude": {"command": "…"}}`. A bare string is not a valid tool entry.
- `repos` is the only place absolute paths may appear anywhere in Dispatch's configuration.
- `enableHooks` gates automation **commands** on this machine; the `set` assignments of an automation rule always apply.

The filename is `<vault name>-<hash>.json`: the vault name with every run of non-`[\w.-]` characters replaced by `_`, and a djb2 hash of the vault's **absolute path** (backslashes included on Windows) as unsigned 32-bit hex:

```js
let hash = 5381;
for (let i = 0; i < vaultPath.length; i++) hash = ((hash << 5) + hash + vaultPath.charCodeAt(i)) >>> 0;
const filename = `${vaultName}-${hash.toString(16)}.json`;
```

*Settings → Dispatch → This device* prints the resolved path — prefer reading it there; the derivation above is for headless setup. The runs file that lifecycle hooks append to sits beside it, under the same basename: `~/.dispatch/runs/<vault>-<hash>.jsonl`.

### The `google` block — Meet transcript import

`scripts/dispatch/meet-fetch.mjs` imports a Google Meet meeting's Gemini document into the vault. It is a **Dispatch-scope** script — Dispatch ships it and it does the same thing for everyone — so its settings are ordinary device settings and live in the same per-vault file as everything else above, under a `google` key. (A script the *project* chooses, like a tracker sync, is configured by the project instead; that split is the whole of ADR-0027.)

Paste the OAuth client JSON the Google Cloud Console gives you **unchanged** under `google` — the nested `installed` block is understood as-is. `account` is optional and only pre-selects the right identity on the consent screen; `refresh_token` is written by the script after consent, never by hand:

```json
{
  "repos": { "my-project": "C:\\Users\\me\\Workspace\\my-project" },
  "calendarUrl": "https://calendar.google.com/calendar/ical/…/basic.ics",
  "google": {
    "installed": {
      "client_id": "….apps.googleusercontent.com",
      "client_secret": "…"
    },
    "account": "you@example.com"
  }
}
```

The script reads `calendarUrl` from the same file: the calendar feed carries each meeting's document as an `ATTACH` property, which is how it finds a transcript without any Drive permission at all.

**Finding the file from a shell.** The script must work with no Obsidian running, so it looks in three places: `--config <path>`, then the `DISPATCH_LOCAL_SETTINGS` environment variable Dispatch sets when it launches the script, then the single `~/.dispatch/<vault>-<hash>.json` on the machine. With more than one vault it stops and asks for `--config` rather than guessing — *Settings → Dispatch → This device* prints the exact path.

> ⚠️ **This file now holds a client secret and a refresh token.** It always lived outside the vault and never syncs, but it used to contain only paths and command templates. Treat it as you would an SSH key, and note that anything copying it — including Dispatch's own "adopt settings" prompt when a vault moves — is copying credentials.

Upgrading from an earlier version? A `~/.dispatch/google.json` from before this change is folded into the vault's device file automatically on the next run, and the old file is deleted.

**One-time setup in the Google Cloud Console**, signed in as the account that holds the meetings:

1. **APIs & Services → Library** — enable the **Google Drive API** and the **Google Docs API**.
2. **Google Auth Platform → Branding** — an app home page, privacy policy and terms of service, all on a domain you have verified in [Search Console](https://search.google.com/search-console). Google rejects URLs on a domain you do not own, so a GitHub or plugin-directory page will not do.
3. **Data Access → Add or remove scopes** — add both, pasting them into *Manually add scopes* if the picker does not list them:
   - `https://www.googleapis.com/auth/drive.meet.readonly` — finds the meeting's document
   - `https://www.googleapis.com/auth/documents.readonly` — reads it. Discovery and content are separate grants; with only the first, Google answers "not found" for the document it just listed.
4. **Audience → Publish app** so the status is **In production**. In *Testing*, Google expires the refresh token after **7 days** and you re-authorise every week. Do **not** submit for verification: a restricted scope makes that an annual third-party CASA assessment, and an unverified production client works for its own owner.
5. **Credentials → Create credentials → OAuth client ID → Desktop app.** Desktop clients accept a loopback redirect with no registered URI, which is what the script uses.

Then, once per machine:

```bash
node scripts/dispatch/meet-fetch.mjs --auth
```

An **"unverified app"** screen is expected — *Advanced → Go to … (unsafe)*. That is the consequence of step 4, not a fault. The refresh token is written back into `google.json` and every later run is non-interactive. Re-run `--auth` if the script ever reports the token as no longer valid; Google revokes them on a password change.

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
- **The plugin makes no Google requests.** `scripts/dispatch/meet-fetch.mjs` does, when you run it — read-only, with credentials you supply. It ships in this repository, not in the plugin bundle; the plugin stores its settings and never uses them. See the [privacy policy](https://eightnine.de/dispatch/privacy.html) for what those scopes cover.

## Building from source

```bash
npm install
npm run dev     # watch build (main.js with inline sourcemap)
npm run build   # type-check + production build
npm test        # vitest suite against the fixture wiki in test/vault
npm run lint    # Obsidian's own plugin ruleset (what the directory review runs)
```

Symlink or copy the repo folder into a test vault's `.obsidian/plugins/dispatch/`, then use Obsidian's "Reload app without saving" command after a build.
