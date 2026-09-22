# Workflow: lint-vault

> Project-local recurring maintenance for US00034. `.claude/commands/lint-vault.md` and
> `.codex/skills/lint-vault/SKILL.md` are pointer-only stubs. This workflow is deliberately not part
> of the generic `dispatch-setup` starter inventory.

Finds and resolves vault link-graph and property drift. It takes no arguments.

## Detect

1. Read `dispatch/invariants.md` and `wiki/02_Product/Reports/_definitions/Vault lint.md` completely.
2. Confirm the `wiki` symlink resolves and Obsidian is running. Run:
   `node scripts/dispatch/lint-vault.mjs --vault Dispatch-Wiki --format json`.
3. Exit code `0` is clean: report that briefly and make **no wiki write**, including no [[log]] entry.
   Exit code `2` is an operational failure: report it and stop. Exit code `1` is a valid report with
   findings; preserve the JSON and continue.

## Repair

4. Work every unresolved link. Retarget it when the intended page is unambiguous; otherwise remove
   only the wikilink markup and preserve its label. If either choice changes meaning, ask the user.
   There is no unresolved-link allowlist.
5. Work every orphaned Markdown page into [[index]] or, for historical-only evidence, [[log]]. The
   detector already excludes non-Markdown assets from this category.
6. For each unclassified dead end, add the missing relationship, move it into an already-reviewed
   category, or ask. Add a `deadend_paths` exception only with a durable reason written beside the
   rule in the rulebook; never use a dead-end classification to suppress an unresolved link.
7. Compare every undeclared property with [[Frontmatter Properties]], the page templates and its
   actual uses. Repair misspellings at their sources. Otherwise document it and update the relevant
   template when one exists. A suggestion in the report is evidence to inspect, not a rename order.
8. Respect the ticket freeze: after `In progress`, contract prose is read-only. Put new facts in the
   record zone and annotate a wrong frozen sentence rather than rewriting it.

## Close

9. Rerun the detector after repairs. Continue until it is clean or a user decision blocks a finding.
10. If the initial run had findings, prepend exactly one dated `lint` entry to [[log]] naming the
    affected pages, the disposition of every category, the final detector result, and any blocked
    item. Update [[index]] in the same pass when pages or descriptions changed. A blocked run is not
    clean even after its log entry.
11. Report the initial counts, repairs, final counts and any question in a short list. Never claim a
    clean run from skipped CLI output or a failed command.
