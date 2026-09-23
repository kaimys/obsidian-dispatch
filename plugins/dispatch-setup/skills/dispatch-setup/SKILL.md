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
4. **Check the repo's layout before writing anything into it.** Everything Dispatch adds to a repository lives in one folder, `dispatch/` — `workflow/`, `scripts/`, `invariants.md`, `settings.yaml` and the git-ignored vault link `wiki` — so a repository either visibly has a setup or does not. A project set up by an older version of this skill has its scripts in `scripts/dispatch/` (and a tracker script at `scripts/move-ticket.mjs`), and may reach its vault through an absolute path or a root `wiki` link. **Never scaffold the new layout beside the old one**: two copies of `run-state.mjs` drift, and the hooks keep calling the old one. Instead, run this skill's migration without applying anything:

   ```bash
   node <this skill>/assets/migrate-layout.mjs --repo "<repo>" --vault "<vault>"
   ```

   It prints every move and rewrite it would make, and nothing when the repository is already on the new layout. **Show the user that list and ask once.** On a yes, run it again with `--apply`, then the validator (step 8). On a no, leave the repository untouched, and say that the project keeps working on its old layout: the plugin reads no path from it. If the migration rewrote `.codex/hooks.json`, the Codex hooks are un-trusted from that moment (step 7.5).

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
- Which commands prove the code repository is valid? Use its real build/lint/test commands for `<<GATES>>`. If this is a fresh repository with no gate, copy this skill's `assets/validate.mjs` to `dispatch/scripts/validate.mjs` and use `node dispatch/scripts/validate.mjs` — never name a gate file you did not create and run.
- **Last step — propose workflow skills for the CODE repo (the glue).** Chips only carry `/command {{id}}` one-liners; the actual workflow logic must live **in the user's code repository** — not the wiki — so it versions with the code, travels through git to every teammate, and is reviewable like code. Scaffold the shipped catalog below and adapt its vocabulary to their lifecycle, each skill pre-wired to a chip:

<!-- shipped-workflows:start -->

| File | Invocation argument | Reads | Writes / review surface | Exit and authority |
| --- | --- | --- | --- | --- |
| `create-ticket.md` | `description + source` | source, templates, existing tickets | ticket + tracker task; index/log | Intake is ungated; starts in the new-ticket column |
| `refine.md` | `id` | spec, links, code, discussion | answers and criteria in the ticket; open_questions | Human ends refinement; card stays put |
| `update-ticket.md` | `id` | inline feedback, thread, tracker, code drift | updated spec and recounted counters | No status move; respects frozen contracts |
| `implementation-plan.md` | `id` | refreshed spec, code, binding ADRs | plan in the ticket; ADRs after sign-off | Human signs off; card stays put |
| `develop.md` | `id` | approved plan and criteria | code/tests; as-built notes; invalidated counts cleared | Explicit invocation + preconditions enter development; fresh reviewer next |
| `code-review.md` | `id` | ticket, diff, current build, tests | dated findings in the ticket; open_findings | Independent session; blocking findings prevent test-plan |
| `test-plan.md` | `id` | code-complete ticket, green gates, clean review | manual checks; open_tests; frozen contract | Enters review after verified preconditions; human completes remaining checks |
| `fix-bug.md` | `report` | report, duplicates, affected code | bug ticket, small fix, actual verification and completion record | Explicit shortcut only; stops when full workflow or a human check is needed |
| `release.md` | `version` | version scope, verified tickets, project release policy | release note, version/build; released tickets + tracker | Explicit release request and readiness gates; publishing follows project policy |
| `meeting.md` | `agenda or report` | board, or transcript and discussion | meeting note; decisions folded into tickets | Agenda before; report requires transcript; no invented decisions |

<!-- shipped-workflows:end -->

**Link the vault first.** Workflows reach the vault through `dispatch/wiki`, a git-ignored link from the repository root to the vault: `New-Item -ItemType Junction -Path dispatch\wiki -Target "<vault>"` on Windows, `ln -s "<vault>" dispatch/wiki` elsewhere, and `/dispatch/wiki` in `.gitignore`. Substitute `dispatch/wiki` for `<<WIKI>>` — never the vault's absolute path, which would tie every workflow to this machine. Each teammate creates the link once in their own checkout.

**Scaffold from `assets/commands/`**, not from memory. Read its README for the adaptation contract and complete placeholder vocabulary, including `P_COMPLETED`. Copy each body into `dispatch/workflow/<name>.md` and substitute the values. Retain its description for stub metadata. `<ARGS>` is a runtime argument, not an installation token; the agent stub supplies it explicitly. No canonical body relies on Claude expanding `$ARGUMENTS`.

**Existing setup:** review differences and merge the intended changes into canonical files rather than overwriting adaptations. Document optional recurring examples separately; they are not shipped workflows.

**One canonical file, one stub per agent.** The workflow body goes to `dispatch/workflow/<name>.md` — one file, whichever agents the user runs. Each agent then gets a **stub** that carries only its own format's frontmatter and a pointer to that file, and no steps:

| Agent | Stub | Frontmatter it needs |
| --- | --- | --- |
| Claude Code | `.claude/commands/<name>.md` | `description`, `argument-hint` |
| Codex | `.codex/skills/<name>/SKILL.md` | `name`, `description` |

A stub says *read `dispatch/workflow/<name>.md` now and follow it exactly*, and substitutes the argument the caller passed. Writing steps into a stub is the failure to avoid: the other agent never sees them, and nothing errors — it just quietly improvises. Check the stub body (excluding descriptive YAML metadata) for workflow steps: it contains only the canonical path and argument hand-off, never gate or status instructions. Adapt names, statuses and tracker calls to their answers; every status move must update wiki frontmatter *and* tracker per the source-of-truth decision (step 6). Chip repository fields reference aliases only. The workflow vault lookup may be repo-relative (preferred, including a git-ignored symlink) or temporarily absolute pending portable project setup; explain that an absolute workflow path needs adaptation on other machines. Never put absolute paths in notes/shared settings. Follow the command README's status-role mapping: a ready queue needs human authorization, while extra human/automation columns need no workflow token. The fuller catalog, with what each skill reads and writes, is [`docs/skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md).

### Stub hand-off examples

Use the workflow name, its description and its argument hint in these existing formats.
Replace `<name>` with the body's filename without `.md`, and `Workflow description` and
`<hint>` with that body's own `description` and `argument-hint` — copy the hint verbatim
rather than inventing one, since it is what the user sees when the command is offered.
Leave runtime argument instructions intact.

<!-- claude-stub:start -->
```markdown
---
description: Workflow description
argument-hint: <hint>
---
# /<name> $ARGUMENTS
Read `dispatch/workflow/<name>.md` now and follow it exactly.
Wherever it says `<ARGS>`, substitute: $ARGUMENTS
```
<!-- claude-stub:end -->

<!-- codex-stub:start -->
```markdown
---
name: <name>
description: Workflow description
---
# <name>
Read `dispatch/workflow/<name>.md` now and follow it exactly.
Wherever it says `<ARGS>`, substitute the arguments you were invoked with (`<hint>`).
```
<!-- codex-stub:end -->

`fix-bug` requires the user's explicit shortcut request in its body; availability as a
skill does not grant that request. Preserve the existing release invocation policy
when updating a project. Validate both agent hand-offs against a real invocation.

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
      { "value": "Released", "progress": 100 },
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
      { "label": "Start refinement", "intent": "refine", "repo": "my-app", "prompt": "/refine {{id}}" },
      { "label": "Code review", "intent": "code-review", "repo": "my-app", "prompt": "/code-review {{id}}" }
    ],
    "columnTemplates": [
      { "label": "Refine all tickets", "repo": "my-app", "prompt": "Work through these tickets sequentially with the full /refine workflow: {{ids}}." }
    ]
  }
}
```

Mistakes that silently produce a broken board:

- Columns are **objects**, not pipe strings. The UI's `-` progress becomes `"excluded": true` — *never* `"progress": "-"`. Omit `label` to display the raw value; omit `wip` for no limit.
- `chips.templates` (card chips) and `chips.columnTemplates` (batch chips on the column header; prompts get `{{ids}}`, `{{status}}`, `{{count}}`) are **separate lists**.
- With more than one selected agent, write **one template per intent**, omit `tool`, and give command chips a stable `intent`. Never clone a workflow into `(Claude)` and `(Codex)` rows: one row already opens the per-tool picker, and the device config below supplies each agent's invocation prefix. Apply the same rule to meeting/calendar command chips.
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
    "claude": {
      "command": "start \"Dispatch Claude\" /d {{cwd}} cmd /k claude {{prompt}}",
      "promptPrefix": "/"
    },
    "codex": {
      "command": "start \"Dispatch Codex\" /d {{cwd}} cmd /k codex {{prompt}}",
      "promptPrefix": "$"
    }
  },
  "calendarUrl": "",
  "enableHooks": false,
  "confirmBeforeRun": true
}
```

- `tools` maps a name to an **object** (`{"command": "…", "promptPrefix": "…"}`), never to a bare string — the most common hand-editing mistake. Keep only the agents the user selected. For every selected command-oriented agent, the prefix is data, not prose: Claude `/`, Codex `$`, including a single-agent setup.
- **Windows: use `start`, never `wt.exe`** (Windows Terminal parses `;` inside quoted args as a tab separator). macOS: use one `osascript` command per agent, preserving that agent's CLI and the quoted `{{prompt}}`.
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

- Define **virtual chip templates** in `data.json` — objects `{ "label": …, "intent": …, "repo": …, "prompt": … }`, with optional `tool` only for a genuinely tool-specific action (the `label | tool | repo | prompt` form is the settings UI's input syntax, not the stored shape). Card prompts get `{{id}}`, `{{status}}`, `{{file}}`, `{{title}}`; column-header prompts get `{{ids}}`, `{{status}}`, `{{count}}`; meeting and calendar chips get `{{date}}` and `{{title}}`.
- Best practice: prompts are one-liners (`/refine {{id}}` for Claude, `$refine {{id}}` for Codex) whose step-by-step logic lives in the target repo's `dispatch/workflow/`, with a thin stub per agent. Scaffold them from **`assets/commands/`** in this skill rather than improvising — the shipped workflows above cover the ticket loop, the small-bug shortcut, releases and meetings, each a `<<PLACEHOLDER>>` search-and-replace away from working. **The prompt differs per agent only by its leading character**, so set both tool prefixes in the device config (`claude = /`, `codex = $`) rather than writing a prompt per chip. Their vault-side counterparts (ticket, bug, ADR, release-note and meeting templates) are in **`assets/templates/`**. Rationale and catalog: [`skills.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/skills.md), [`page-types.md`](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/page-types.md).
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
- **Precedence**: accepted and proposed ADRs both bind; only superseded decisions may be ignored. Declare precedence when documents conflict, plus which side wins on a wiki ↔ tracker disagreement (recommend: the wiki).
- **Artifact and review surface:** each workflow leaves its durable result in the note, which is where the human reviews it.
- **Gates are gates:** `open_questions: 0` before leaving refinement, `open_findings: 0` before the test plan is written (the code review runs before the freeze), `open_tests: 0` before leaving review; no skill moves a ticket across a gated boundary on its own.
- **Explicit small-bug exception:** `/fix-bug` may omit independent code review only for a known, small-blast-radius fix. Create its ticket before code; run mechanical gates and verify the reproduction; record the actual results and omitted review. Leave `open_findings` empty. Complete only with no open questions/manual checks and a known target version; freeze the finalized contract, stamp completion and mirror the tracker. Stop and warn when the work grows, verification fails or needs a human. Never run `/test-plan` with its review gate unmet, or treat this as a general review toggle.
- **Direct status writes:** workflows stamp the configured completion property themselves and mirror the tracker; drag automations do not fire for frontmatter writes. Preserve existing completion dates.
- **Unset is not zero.** An empty counter is *no statement* and renders no badge; `0` is *counted, and clear*. So a new ticket leaves `open_tests:` and `open_findings:` empty rather than seeding `0`, and a skill that invalidates a count — fixing code under a review, say — clears the property instead of writing `0`. Only the skill that actually counted may write a number, or the gate can be satisfied by a stale one.

## 6 · Tracker sync (optional but the biggest win)

Add an automation rule in `data.json` so drags push to the tracker:
```json
{ "when": [], "set": {}, "repo": "<alias>", "command": "node dispatch/scripts/move-ticket.mjs {{file}} {{from}} {{to}}" }
```
Scaffold `dispatch/scripts/move-ticket.mjs` in their repo: map status → tracker column/section ID, find the task by the ticket-ID naming convention, move it via the tracker's API (token from env/.env — never hardcode), print ONE line (it becomes the Obsidian notice). Statuses without a tracker column: print a skip message, exit 0. **Windows: never `process.exit()` after async work** (libuv teardown race → false failures) — set `process.exitCode` and return. A `--dry-run` flag makes it testable. Add a `set` rule for completion stamping too: `{ "when": ["Done"], "set": { "done": "{{date}}" } }` — it feeds the milestone velocity forecast (completedProperty).
Decide with the user which side is the **source of truth** (recommend: the vault; tracker follows) and write that down in their project docs. Then enable *automation commands on this device*.

## 7 · Run-lifecycle hooks

So board cards show launched → running ⇄ waiting → done and completed runs log back into the note. **Wire this for every agent the user runs** (step 1's interview) — one script serves them all:

1. **Copy the reference implementation that ships with this skill** — `assets/run-state.mjs` in this skill's own directory — into the target repo as `dispatch/scripts/run-state.mjs`. It is dependency-free, fully synchronous and needs no edits. (What it does: appends `{id, state, ts}` to `$DISPATCH_RUNS_FILE`; on `done` also appends a run-log line plus an excerpt of the agent's final message — read from the `transcript_path` in the hook's **stdin JSON**, not from an env var — to `$DISPATCH_NOTE` under `## Dispatch runs`, newest first; silent no-op when `DISPATCH_RUN_ID` is unset, so normal sessions are undisturbed. Contract: [`installation.md` → Run lifecycle](https://github.com/kaimys/obsidian-dispatch/blob/main/docs/installation.md#run-lifecycle).)
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

**Verify headlessly first, and treat the result as a completion gate.** If the project uses the shipped validator, run `node dispatch/scripts/validate.mjs --device "<absolute device-config path>" --vault "<absolute vault path>"`; setup already knows both paths from step 0 and must pass the vault explicitly rather than inventing a chip-repository alias for it. With neither option it checks only the repository surface for later workflow gates; ambient `DISPATCH_LOCAL_SETTINGS` from a chip launch does not change that result. Do not report setup complete, and do not move on to the UI smoke test, while it or any equivalent check below is red or unrun:

- every JSON file parses — `data.json`, `community-plugins.json`, the device config, and the hook config of each agent wired in step 7 (`.claude/settings.json`, `.codex/hooks.json`);
- every chip `repo` alias resolves to a directory that exists on this device, and every `tool` a chip names is defined in the device config;
- with multiple tools, every command chip has one stable intent, no explicit tool, no duplicate intent, and resolves through each selected tool's configured prefix (`/name` for Claude, `$name` for Codex);
- for each note in the source folders: required properties present, the `status` value matches a configured column **exactly** (this is what the ⚠ panel flags), `version_target` present in `plannedVersions`, and each counter property (`open_questions`, `open_tests`, `open_findings`) either **empty** — nothing has counted it yet — or equal to the actual number of open items in its section; a `0` on a ticket whose section does not exist yet is the failure worth looking for, because it reads as a passed gate;
- `milestones.completedProperty` is actually stamped by an automation rule, and matches the completion property in the ticket templates;
- **no `<<PLACEHOLDER>>` survived** in the scaffolded workflow files or templates — `grep -rE '<<[A-Z][A-Z0-9_]*>>' <workflow dir> <vault>/<templates>` must come back empty;
- every chip prompt names a command that exists in the repo;
- **`.claude/settings.json` contains no absolute path** — the hook paths must still be the unexpanded project-directory variable (step 7.2). A drive letter or home directory in there is the single easiest way to commit one machine's layout to the whole team;
- the run-state hook behaves (step 7.3);
- **the invariants file and every chosen agent's pointer exist** (step 5) — `dispatch/invariants.md`, plus `CLAUDE.md` and/or `AGENTS.md`; and grepping a pointer file for a rule it should only be pointing at (the freeze, a gate counter) comes back empty;
- **for Codex: hook trust has actually been granted** (step 7.5). Check `~/.codex/config.toml` for a `[hooks.state.…]` entry naming the repo's `.codex/hooks.json`. Its absence, with everything else correct, is exactly the state that looks like a broken plugin.

Keep a checklist of these checks in the final report and mark each one pass/fail. A command not run is **incomplete**, never an implicit pass. The live smoke test below must then exercise every selected agent from the same generated command chip; needing to edit generated config first is a setup failure to record, not a successful setup.

Then walk the user through the UI, verifying each:

1. ↻ reload → Kanban shows the configured columns; ⚠ problems panel reviewed (fix malformed tickets now, not later).
2. Drag a card one column → frontmatter updated + tracker moved (if step 6) + notice shown.
3. Right-click a card → chip launches the agent in the right repo; badge lifecycle runs through; `## Dispatch runs` line appears on session exit, naming the agent that ran. **With more than one agent configured the chip asks which to run** — check that each button previews its own command, and run the cycle on each agent, not just the first.
4. Milestones tab: versions grouped correctly, released columns link their notes, forecasts only on unreleased versions. Test patch expansion only when at least two configured patches share a major/minor line; a one-patch line intentionally has no expand control.

## Known pitfalls (tell the user proactively when relevant)

- **Writing the settings UI's display forms into the JSON files** — pipe-delimited column strings, `"progress": "-"` instead of `"excluded": true`, or `"tools": {"claude": "start …"}` instead of `{"command": "…"}`. The file still parses; the board silently ignores it. See steps 2 and 3.
- If the vault lives **inside the code repo**, check whether it is git-ignored before telling the user teammates will receive the board config — a `docs/wiki` in `.gitignore` makes the "shared" layer device-local in practice.
- Statuses are matched exactly — unify quoted/unquoted YAML variants is unnecessary (same value), but typos/casing split columns.
- Chips/board are desktop-only; mobile shows nothing.
- A chip aborts with a notice if a referenced variable (e.g. `{{id}}`) is empty — that means the note's frontmatter is incomplete, see the ⚠ panel.
- Meeting/action-item counting parses `- [ ]` checkbox lines (bold owner lines for attribution) — agents editing notes must preserve that format.
- `data.json` edits from outside Obsidian need the ↻ reload button.
