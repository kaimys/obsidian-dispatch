# CLAUDE.md

**Read [`dispatch/invariants.md`](dispatch/invariants.md) first — it holds every project
invariant, and it is the canonical copy.** This file carries only what is specific to Claude Code.
If the two ever disagree, the canonical file wins; fix it there rather than here ([[ADR-0020]]).

## Workflow commands

`.claude/commands/*.md` are **stubs**. Each one points at `dispatch/workflow/<name>.md`, which
holds the steps, and is shared with every other agent. A step written into a stub is a step Codex
never sees — so edit the canonical file. `grep` for a workflow term (`open_questions`, `frozen:`)
under `.claude/commands/` should come back empty.

## Naming the session

The convention is in the canonical file. The mechanism here is `set_session_title` with
`session_id: "self"`.

## Run-lifecycle hooks

`.claude/settings.json` wires four events to `scripts/dispatch/run-state.mjs`, which reports chip
run state back to the board and appends the run log to the note:

| Event | State |
| --- | --- |
| `SessionStart` | `running` |
| `UserPromptSubmit` | `running` |
| `Stop` | `waiting` |
| `SessionEnd` | `done` |

The script is a silent no-op outside a chip-launched session — it keys off the `DISPATCH_*`
environment variables the plugin sets, and does nothing when they are absent.
