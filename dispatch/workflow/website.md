# Workflow: website

> The one canonical copy of this workflow (ADR-0020). `.claude/commands/website.md` and
> `.codex/skills/website/SKILL.md` are stubs that point here and carry no steps. `<ARGS>` is what
> the caller passed — nothing, or `--check` to build without publishing.

Publishes the project website from the vault (US00018). Editors run it after marking an article, the
FAQ or a link ready, or after adding a testimonial; `/release` runs it after a release is published,
so Documentation and Releases follow the new tag. The pipeline is Dispatch-scope and lives in
`dispatch/scripts/website.mjs`; the site's configuration and design live in `dispatch/website/`.

**What gets published is decided by the vault, never by this workflow** (ADR-0039, ADR-0040): only
notes in the website folder with `status: ready`, every testimonial and legal note, each released
version's `## GitHub release body`, and `docs/` at the newest release tag. Never mark a note ready,
edit an article, or add a testimonial to make a build pass — those are the editor's decisions.

## Check

1. Confirm `dispatch/wiki` resolves (see `dispatch/invariants.md` for creating it) and that `zola
   --version` answers. A missing Zola is a stop: name the install page the script prints.
2. Run `node dispatch/scripts/website.mjs build`.
3. **A finding is a stop.** Each one names a file and line: a wikilink to an unpublished page, a
   file outside the published set, a local or vault path, an image without alt text, a Mermaid
   diagram without `accTitle`/`accDescr`, or a missing required property. Report every finding to
   the user with the choice each one needs — publish the linked page too, or unlink it; move the
   file into the website folder, or drop it — and let them decide
   ([[ADR-0033]] applies: never silently turn a link into plain text). Do not publish.
4. Report what the build published and what it skipped as *not published*, with the reason the
   script gives. A note an editor expected to see but which is skipped is almost always a missing or
   mistyped `status: ready`.

With `--check`, stop here.

## Publish

5. **Ask before publishing**, naming what changes on the live site (new, changed and withdrawn
   pages since the last publish). Publishing pushes to the `gh-pages` branch, which is public the
   moment it lands.
6. Run `node dispatch/scripts/website.mjs publish`. It refuses while only the starter theme would
   render (`dispatch/website/templates/index.html` missing): the starter theme is for local tests
   and is never deployed. If it refuses, stop and say so — do not create a template to get past it.
7. **Verify the live site** rather than assume it: GitHub Pages takes a minute or two after the
   push. Fetch the `base_url` from `dispatch/website/config.toml` and one page that changed, and
   confirm they answer with the new content. If Pages is not enabled on the repository, say so; the
   one-time enabling is a human's decision.

## After a legal change

8. When a note in the website folder's `Legal/` changed, the eightnine.de copies need regenerating
   too, because Google's OAuth consent screen points there. Run `node
   dispatch/scripts/eightnine-legal.mjs`, show the user the word diff it prints, and only on their
   go-ahead run it with `--write` and commit `docs/privacy.html`, `terms.html` and `impressum.html`.
   Uploading them to eightnine.de stays manual.
