---
description: Ship a version — test pass, bump, release note generated from the board, tag, promote the shipped tickets, announce.
argument-hint: [version]
---

# /release $ARGUMENTS

Releases one version. `$ARGUMENTS` is the target version (e.g. `v1.4.0`); without it, use the next planned version from the Release Plan.

**The step order is load-bearing.** Prove the candidate before touching production; refresh any mirror of a backend *before* promoting it; build production *after* the promotion, because that build talks to the promoted backend. Each reordering has bitten someone — if you change the order, write down why.

## Scope the release

1. **The release scope is what the board says it is:** every ticket whose `version_target` matches, in `docs/wiki/05_Requirements/Tickets`. Anything shipped without a ticket is invisible here — which is the practical argument for no-ticket-no-merge.
2. Verify each in-scope ticket is actually ready: at `Review` or beyond with `open_tests: 0`. **List the ones that aren't and stop.** Either they get finished, or they get moved to the next version — both are the user's call, not yours.
3. Confirm today's date with `date`.

## Prove it

4. Full test pass on a **non-production** environment: the automated gates
   ```
   npm run build && npm run lint && npm test
   ```
   plus the manual plans of the in-scope tickets if they haven't been signed off yet.
5. Fix-or-defer any failure explicitly. A release note that lists a ticket whose tests never passed is worse than a delayed release.

## Cut it

6. Bump the version in the project's manifest(s), consistently — one source of truth, everything else derived.
7. **Write the release note** `docs/wiki/08_Delivery_and QA/Releases/<version>.md` from `docs/wiki/00_Start-Here/Templates/release-note.md`: `version:` and `date:` frontmatter exactly as the template shows — **the Release Plan tab parses these**, and a malformed one silently drops the release from the board. Contents: what shipped as **links to the tickets** (they carry the detail — don't restate it), build metadata, and what deliberately did not make it.
8. **Write the `## GitHub release body` section** into the same note — mandatory, and the only part written for people outside the team. Everything else in the note links into the vault; **the vault is git-ignored**, so a `[[wikilink]]` or a `docs/wiki/…` path pasted into GitHub is dead text or a 404. Inside a ```` fenced block (so it copies verbatim), translate every reference to an absolute GitHub URL: a ticket becomes its `discussion:` issue (`https://github.com/kaimys/obsidian-dispatch/issues/<n>`), a past release becomes `…/releases/tag/<version>`, a commit becomes `…/commit/<sha>`, a repo doc becomes `…/blob/<tag>/docs/<file>.md` — and an **ADR becomes prose**, because ADRs are not published. Write full URLs rather than bare `#5`. End with `**Full changelog:** …/compare/<previous>...<this>`. Never paste the internal note into GitHub instead.
9. Build, tag and publish per the project's process.

## Land it

10. **Promote the shipped tickets:** status → `Done`, and **stamp `completed: <today>` yourself** on each one. Dispatch's automations run on a board *drag*; frontmatter you write directly does not trigger them, so a promotion done here leaves `completed:` empty and the velocity forecast starves. Close the matching GitHub issue too (`gh issue close --reason completed`, or let the next drag do it). Anything deferred gets its `version_target` moved forward — not silently dropped.
11. Announce in none with a link to the release note.
12. Report: version, ticket count, anything deferred and why. Hand the user the `## GitHub release body` block to paste, with the link to the draft — publishing stays manual (ADR-0018).
