# Workflow: release

> The one canonical copy of this workflow (ADR-0020). `.claude/commands/release.md` and
> `.codex/skills/release/SKILL.md` are stubs that point here and carry no steps. `<ARGS>` is
> what the caller passed — `[version]`.

Releases one version. `<ARGS>` is the target version (e.g. `v1.4.0`); without it, use the next planned version from the Release Plan.

**The step order is load-bearing.** Prove the candidate before touching production; refresh any mirror of a backend *before* promoting it; build production *after* the promotion, because that build talks to the promoted backend. Each reordering has bitten someone — if you change the order, write down why.

## Scope the release

1. **The release scope is what the board says it is:** every ticket whose `version_target` matches, in `dispatch/wiki/05_Requirements/Tickets`. Anything shipped without a ticket is invisible here — which is the practical argument for no-ticket-no-merge.
2. Verify each in-scope ticket is actually ready: at `Review` or beyond with `open_tests: 0` and `open_findings` empty or `0` — empty is tolerated here, unlike in `/test-plan`, because tickets that predate the review step never had one. **List the ones that aren't and stop.** Either they get finished, or they get moved to the next version — both are the user's call, not yours.
3. Confirm today's date with `date`.

## Prove it

4. Full test pass on a **non-production** environment: the automated gates
   ```
   npm run build && npm run lint && npm test
   ```
   plus the manual plans of the in-scope tickets if they haven't been signed off yet.
5. Fix-or-defer any failure explicitly. A release note that lists a ticket whose tests never passed is worse than a delayed release.

## Cut it

6. **Bump the version — on the branch being released, before it merges.** That is `develop` for a minor or major, the fix branch for a patch (see *Patch release*). Use `npm version <patch|minor|major> --no-git-tag-version` and commit the result yourself (`chore(release): <version>`): the tag belongs on `main`'s tip *after* the merge (step 9), and `npm version`'s own tag would land it on the branch that produced the bump — the wrong commit the moment that merge is not a fast-forward. Keep the project's manifest(s) consistent — one source of truth, everything else derived. **In this repo that is more than one file, and they must stay in step**: `manifest.json` + `versions.json` (the plugin, via `npm version`), and — when the setup skill changed — `plugins/dispatch-setup/.claude-plugin/plugin.json` *and* `plugins/dispatch-setup/.codex-plugin/plugin.json`, which are two manifests for one plugin and must never disagree. Check the pair before tagging: a Codex user installing `dispatch-setup@dispatch` gets the version the `.codex-plugin` manifest states, whatever the Claude one says.
7. **Write the release note** `dispatch/wiki/08_Delivery_and QA/Releases/<version>.md` from `dispatch/wiki/00_Start-Here/Templates/release-note.md`: `version:` and `date:` frontmatter exactly as the template shows — **the Release Plan tab parses these**, and a malformed one silently drops the release from the board. Contents: what shipped as **links to the tickets** (they carry the detail — don't restate it), build metadata, and what deliberately did not make it.
8. **Write the `## GitHub release body` section** into the same note — mandatory, and the only part written for people outside the team. Everything else in the note links into the vault; **the vault is git-ignored**, so a `[[wikilink]]` or a `dispatch/wiki/…` path pasted into GitHub is dead text or a 404. Inside a ```` fenced block (so it copies verbatim), translate every reference to an absolute GitHub URL: a ticket becomes its `discussion:` issue (`https://github.com/<tracker.repository>/issues/<n>`, with `tracker.repository` from `dispatch/settings.yaml`), a past release becomes `…/releases/tag/<version>`, a commit becomes `…/commit/<sha>`, a repo doc becomes `…/blob/<tag>/docs/<file>.md` — and an **ADR becomes prose**, because ADRs are not published. Write full URLs rather than bare `#5`. End with `**Full changelog:** …/compare/<previous>...<this>`. Never paste the internal note into GitHub instead.
9. **Preview-scan the release branch, then merge into `main` and tag it.**

   **First, the directory's preview scan: a gate, not a courtesy.** Push the branch being released with its bump commit (`develop`, or the fix branch for a patch), so the scan sees the version that will ship. Then a person opens the Obsidian community directory's developer dashboard for this plugin, selects **Review branch**, enters that branch, and selects **Run preview scan**. The scan is dashboard-only; there is no API or CLI for it, so an agent asks for the result and never assumes it. **An error stops the release** before anything is merged or tagged: fix it on the branch, re-run the gates (step 4) and the scan. Each warning is either fixed or explicitly accepted by the user, and recorded under `## Build` in the release note. The point is the order: a tag burns a version number, so a problem the scan finds after the tag costs a whole new release, as 0.3.1 did. The preview runs before any release exists, so it cannot be relied on to check the release assets or name; step 11 checks those.

   Then the merge and the tag. A person runs this — no bot, no auto-merge, no protected-branch rule:

   ```bash
   git checkout main && git pull --ff-only
   git merge --no-ff develop && git push
   git tag <version> && git push origin <version>
   ```

   **The order is the load-bearing part.** `.github/workflows/release.yml` triggers on *any* tag push with no branch filter, and builds the draft from the tagged tree — so a tag cut before the merge builds something that is not what `main` will hold, and the release artifacts describe a tree nobody can check out at that tag. `main` is the branch someone can install; it moves here and nowhere else.
10. Merge `main` back into `develop` whenever step 9 produced a commit `develop` does not already have (a `--no-ff` merge commit, or a patch released off `main` since). Skip it and the next ticket branches from a base that is behind the release it just shipped.
11. **Publish the drafted release — never create a new one.** The tag push has already built and drafted the GitHub release, with `main.js`, `manifest.json` and `styles.css` attached and attested (ADR-0018). Publishing it stays a human action: open *that draft* (`gh release list` shows it as `Draft` on the tag), paste the `## GitHub release body`, and publish it. **Do not use *Draft a new release*, or `gh release create`, on a tag that already has a draft.** A second release on the same tag carries no assets, and the community-directory review fails on the missing `main.js` and `manifest.json`; 0.3.0 shipped that way. The release **name must contain the version** (e.g. `0.3.0 Better release planning`); the draft's default name is the bare tag, which is fine as it is.

    Once it is published, **verify it** rather than assume it: `gh api repos/<tracker.repository>/releases/latest` must show the tag, a name containing the version, `draft: false` and all three assets. Then check that no second release sits on the same tag (`gh release list`). If the published release lacks its assets, attach the draft's assets to it (the attestation matches by digest, so the same bytes still verify), and only then delete the leftover draft.

    Then **request the directory review** rather than waiting for its periodic check: in the developer dashboard, open the plugin's **…** menu and select **Request review**. The release is not done until the dashboard shows it passing. On a failure, fix what it names. If only the published release was wrong (assets, name), correct it in place and request review again. A new version is needed only when the fix changes what is committed.

## Patch release

A patch never routes through `develop`. It branches a fix branch **directly from `main`**, follows the same *Prove it* and *Cut it* steps (the bump happens on that fix branch), and merges **directly back into `main`**, skipping step 9's `develop` merge; `main`'s new tip is then tagged exactly as above. `develop` needs no freeze for the duration — it is not touched at all. What it does need is step 10: merge `main` into `develop` once the patch has landed, or the fix is missing from the next minor version.

## Land it

12. **Promote the shipped tickets:** status → `Released`, not `Done`. `Done` is the human's manual drag when a test plan is signed off, and it is what stamps `completed:` and feeds the velocity forecast — so do **not** stamp `completed:` here; a ticket reaching a release without it never went through that drag, which is a board problem to raise, not a date to invent. What this step must replicate is the other half a drag would fire: `Released` is the status that closes the tracker issue, so close it yourself (`gh issue close --reason completed`, or let the next drag do it) — frontmatter an agent writes triggers no automation. Anything deferred gets its `version_target` moved forward — not silently dropped.
13. Announce in none with a link to the release note.
14. Report: version, ticket count, anything deferred and why. Hand the user the `## GitHub release body` block to paste, with the link to the draft itself (`gh release view <tag> --json url`, while it is still a draft) and the instruction to **edit and publish that draft**, not to draft a new release. Publishing stays manual (ADR-0018). When the user says it is published, run step 11's verification.
