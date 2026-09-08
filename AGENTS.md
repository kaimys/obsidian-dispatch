# AGENTS.md

**Read [`dispatch/invariants.md`](dispatch/invariants.md) first — it holds every project
invariant, and it is the canonical copy.** This file carries only what is specific to Codex. If the
two ever disagree, the canonical file wins; fix it there rather than here ([[ADR-0020]]).

## Workflow skills

`.codex/skills/<name>/SKILL.md` are **stubs**. Each one points at `dispatch/workflow/<name>.md`,
which holds the steps, and is shared with every other agent. A step written into a stub is a step
Claude never sees — so edit the canonical file.

Invoke one explicitly by name: `$refine US00042`, not `/refine US00042`.

**`release` alone carries `agents/openai.yaml` with `policy.allow_implicit_invocation: false`.** It
bumps a version, pushes a tag and drafts a GitHub release — the one workflow here that must never be
started by inference. Everything else, `create-ticket` included, may be picked up from context: a
ticket is recoverable, a published tag is not.

> ⚠️ **That file is unverified.** The key is recorded in US00002's table from `codex-cli
> 0.149.0-alpha.4.1` and the string exists in 0.153.4, but neither the nesting under `policy:`, nor
> the filename, nor Codex's *default* for implicit invocation has been confirmed against a live
> session — so it may be a no-op, or worse, may stop the skill loading. Check it in the same
> interactive session that establishes hook trust below, before relying on it.

## Naming the session

The convention is in the canonical file. Codex has no equivalent of a "set the session title"
call at the time of writing — if you find one, use it and record it here. Until then, say the
ticket id in your first reply so the session is identifiable in a list, and do not pretend the
title was set.

## Run-lifecycle hooks

`.codex/hooks.json` wires four events to `scripts/dispatch/run-state.mjs`, which reports chip run
state back to the board and appends the run log to the note:

| Event | State |
| --- | --- |
| `SessionStart` | `running` |
| `UserPromptSubmit` | `running` |
| `Stop` | `waiting` |
| `SessionEnd` | `done` |

The script is a silent no-op outside a chip-launched session — it keys off the `DISPATCH_*`
environment variables the plugin sets, and does nothing when they are absent.

Three things this cost a while to learn, all of which fail *quietly*:

- **The path is `.codex/hooks.json`.** Not `.codex/hooks/hooks.json` — that is a plugin layout —
  and not `hooks` inside `config.toml`. A hooks file at the wrong path produces **no warning at
  all**: nothing is read, nothing is reported, and every badge sits at `launched`.
- **A malformed hooks file is a `warning`, and the session runs anyway.** So the absence of an
  error proves nothing. Verify by watching a state transition, never by a clean startup.
- **`codex exec` is the only command that parses this file.** `codex doctor` and `codex debug
  prompt-input` load project config and `AGENTS.md` but never touch hooks — they will accept any
  hooks file at all, including contradictory ones.

The handler shape is **not** Claude's: a command handler is `{ "type": "command", "command": "<one
string>" }` — one string, no `args` array — with optional `commandWindows`, `timeout`, `async` and
`statusMessage`, grouped under `{ "matcher", "hooks" }` inside a top-level `hooks` map keyed by
event.

**Hooks still do not run until they are trusted**, and trust can only be granted interactively.
With the file correct and untrusted, the symptom is identical to having no file: badges stuck at
`launched`, nothing in the terminal. Run `codex` once in the repo and accept the prompt.
