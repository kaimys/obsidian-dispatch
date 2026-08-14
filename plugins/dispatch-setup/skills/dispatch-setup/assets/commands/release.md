---
description: Ship a version — test pass, bump, release note generated from the board, tag, promote the shipped tickets, announce.
argument-hint: [version]
---

# /release $ARGUMENTS

Releases one version. `$ARGUMENTS` is the target version (e.g. `v1.4.0`); without it, use the next planned version from the Release Plan.

**The step order is load-bearing.** Prove the candidate before touching production; refresh any mirror of a backend *before* promoting it; build production *after* the promotion, because that build talks to the promoted backend. Each reordering has bitten someone — if you change the order, write down why.

## Scope the release

1. **The release scope is what the board says it is:** every ticket whose `version_target` matches, in `<<WIKI>>/<<TICKETS>>`. Anything shipped without a ticket is invisible here — which is the practical argument for no-ticket-no-merge.
2. Verify each in-scope ticket is actually ready: at `<<S_REVIEW>>` or beyond with `open_tests: 0`. **List the ones that aren't and stop.** Either they get finished, or they get moved to the next version — both are the user's call, not yours.
3. Confirm today's date with `date`.

## Prove it

4. Full test pass on a **non-production** environment: the automated gates
   ```
   <<GATES>>
   ```
   plus the manual plans of the in-scope tickets if they haven't been signed off yet.
5. Fix-or-defer any failure explicitly. A release note that lists a ticket whose tests never passed is worse than a delayed release.

## Cut it

6. Bump the version in the project's manifest(s), consistently — one source of truth, everything else derived.
7. **Write the release note** `<<WIKI>>/<<RELEASES>>/<version>.md` from `<<WIKI>>/<<TEMPLATES>>/release-note.md`: `version:` and `date:` frontmatter exactly as the template shows — **the Release Plan tab parses these**, and a malformed one silently drops the release from the board. Contents: what shipped as **links to the tickets** (they carry the detail — don't restate it), build metadata, and what deliberately did not make it.
8. Build, tag and publish per the project's process.

## Land it

9. **Promote the shipped tickets:** status → `<<S_DONE>>` in both systems, which stamps the completion date the velocity forecast reads. Anything deferred gets its `version_target` moved forward — not silently dropped.
10. Announce in <<CHAT>> with a link to the release note.
11. Report: version, ticket count, anything deferred and why.
