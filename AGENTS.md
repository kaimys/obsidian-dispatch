# AGENTS.md

**Read [`dispatch/invariants.md`](dispatch/invariants.md) first — it holds every project
invariant, and it is the canonical copy.** This file carries only what is specific to Codex. If the
two ever disagree, the canonical file wins; fix it there rather than here ([[ADR-0020]]).

## Workflow skills

`.codex/skills/<name>/SKILL.md` are **stubs**. Each one points at `dispatch/workflow/<name>.md`,
which holds the steps, and is shared with every other agent. A step written into a stub is a step
Claude never sees — so edit the canonical file.

Invoke one explicitly by name: `$refine US00042`, not `/refine US00042`. Two workflows carry
`agents/openai.yaml` with `policy.allow_implicit_invocation: false` — `release` and `create-ticket`
— because their side effects reach outside the repository (a git tag and a GitHub release; a
tracker issue) and cannot be taken back. They run only when a human names them.

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
