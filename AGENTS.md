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

**Not wired yet.** Dispatch's chip-run badges are driven by `scripts/dispatch/run-state.mjs`,
which Claude Code calls from `.claude/settings.json`. The Codex side —
`.codex/hooks/hooks.json` mapping `SessionStart`/`UserPromptSubmit` → `running`, `Stop` →
`waiting`, `SessionEnd` → `done` — is US00002 Phase D and is not built.

Two things to know when it is:

- The handler shape is **not** Claude's. A command handler is `{ "type": "command", "command":
  "<one string>" }` with optional `commandWindows`, `timeout`, `async` and `statusMessage` — there
  is no `args` array — grouped under `{ "matcher", "hooks", "enabled" }`.
- **Hooks do not run until they are trusted.** A fresh checkout with a correct `hooks.json` and no
  trust shows badges stuck at `launched`, which is indistinguishable from a broken hook. Trust once,
  interactively, before concluding anything is wrong.
