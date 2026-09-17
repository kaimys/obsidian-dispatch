---
description: Ship a version — test pass, bump, release note generated from the board, tag, complete the shipped tickets, announce.
argument-hint: [version]
---

# Workflow: release

Read `dispatch/invariants.md` first. `<ARGS>` is supplied by the invoking agent stub.
Tracker: <<TRACKER>>. Chat: <<CHAT>>. If either is `none`, skip only that integration's lookups, writes and missing-side preconditions; continue the wiki work. With no chat, record questions for the requester in the ticket. A configured but unavailable integration is an error to report, not `none`.

Releases one version. `<ARGS>` is the target version (e.g. `v1.4.0`); without it, use the next planned version from the Release Plan.

**The project's recorded release order is load-bearing.** Follow its documented build, migration, promotion and publication sequence, preserving the reasons it gives. If setup found no release policy, stop before changing versions, production, tags or publications and ask the requester; never invent backend, mirror or deployment steps for a project that did not name them.

## Scope the release

1. **The release scope is what the board says it is:** every ticket whose `version_target` matches, in `<<WIKI>>/<<TICKETS>>`. Anything shipped without a ticket is invisible here — which is the practical argument for no-ticket-no-merge.
2. Verify each in-scope ticket is actually ready: at `<<S_REVIEW>>` or beyond with `open_tests: 0` and `open_findings` empty or `0` — empty is tolerated here, unlike in `/test-plan`, for legacy tickets or an explicitly recorded `/fix-bug` shortcut that omitted review; it never means reviewed. Include already-completed shortcut tickets in the release scope, verify their recorded results and target version, and do not require a second trip through review. **List the ones that aren't and stop.** Either they get finished, or they get moved to the next version — both are the user's call, not yours.
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

9. **Complete the shipped tickets:** write status → `<<S_DONE>>` and stamp `<<P_COMPLETED>>: <today>` yourself, then mirror the tracker. Preserve the original completion date on tickets already completed by `/fix-bug`. Board automations fire on a drag, never on frontmatter an agent writes. A tracker failure is a reported partial synchronization failure; retain the record and retry that operation on the existing issue, not a new ticket. Anything deferred gets its `version_target` moved forward — not silently dropped.
10. Announce in <<CHAT>> with a link to the release note.
11. Report: version, ticket count, anything deferred and why.
