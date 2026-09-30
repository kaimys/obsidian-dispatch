# Website — this project's own steps

> Read by step 8 of the `website` workflow (`dispatch/workflow/website.md`), after a publish. The
> workflow is the Dispatch-standard part that US00069 lifts into `dispatch-setup`; this file is
> Dispatch-the-project's alone, like the design beside it, and is not lifted.

## After a legal change: the eightnine.de copies

1. **When a note in the vault's `10_Website/Legal/` changed**, the eightnine.de copies need
   regenerating too, because Google's OAuth consent screen for the Meet import names
   `https://eightnine.de/dispatch/` as the app's home page. Run
   `node dispatch/scripts/eightnine-legal.mjs`, and show the user the word diff it prints: it
   compares the visible text of each regenerated page with the committed one.
2. **Only on the user's go-ahead**, run it again with `--write` and commit `docs/privacy.html`,
   `docs/terms.html` and `docs/impressum.html`. These three generated pages are the one committed
   exception to "only built HTML enters git, on `gh-pages`" (ADR-0039, amended 2026-09-30).
3. Uploading them to eightnine.de stays manual.

This section and `eightnine-legal.mjs` go together when
US00068 ([#80](https://github.com/kaimys/obsidian-dispatch/issues/80)) removes the OAuth client, and with it
the reason for eightnine.de to carry its own copy of the legal text.
