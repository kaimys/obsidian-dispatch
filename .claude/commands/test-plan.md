---
description: Write the manual test plan for a code-complete ticket — only what automation can't cover — set open_tests, freeze the contract zone, move to review.
argument-hint: <ticket id>
---

# /test-plan $ARGUMENTS

Writes the manual test plan and performs the `In progress` → `Review` transition. `$ARGUMENTS` is the ticket id.

## Prepare

1. Resolve the ticket (spec via `id: $ARGUMENTS` in `docs/wiki/05_Requirements/Tickets`, task in the GitHub Issues of `kaimys/obsidian-dispatch`, via the GitHub MCP or the `gh` CLI) and name the session `$ARGUMENTS - <shortened title>` (e.g. `US00042 - Import Meet transcripts`).
2. **Preconditions:** the ticket is code-complete in `In progress` and the gates are green. This command performs the status move, so verify rather than assume — run them if unsure:
   ```
   npm run build && npm run lint && npm test
   ```

## Analyze automated coverage

3. Identify what the change actually touched, then what the suites already assert for it. **Anything asserted automatically does not belong in the manual plan.** The plan's whole value is being the complement of the test suite — a checklist that re-verifies what CI already proves trains reviewers to tick boxes without looking.
4. What is left is typically: visual and layout verification, platform- or device-specific behaviour, permissions and other real-environment interactions, flows that need a real account or real data, timing and interruption behaviour, and anything a store or compliance reviewer will try by hand.

## Write the plan

5. Replace the spec's `## Test plan` section (record zone) and strip its `<!-- GUIDE: … -->`. Structure: one line naming the change and the build it applies to, then a `- [ ]` checklist. **Every item must be executable by someone without this session's context** — concrete starting point, concrete action, concrete expected result. "Check the settings screen works" is not an item. Assign a tester with a bold prefix (`**Name:**`) where it matters.
6. Set `open_tests:` to the number of checklist items. It is the `✓ N` badge and the gate out of review: reviewers tick items and decrement it, `0` means manual review is complete.

## Freeze and move

7. **Stamp `frozen:` with today's date** (confirm with `date`). The ticket now leaves development, so the contract zone — goal/symptom, acceptance criteria, open questions and their answers, scope, implementation plan — is closed. From here, new information is a dated entry in the record zone, and a wrong frozen statement gets an annotation beneath it rather than a rewrite. Stamping it here, rather than at review time, means the boundary survives the card being dragged backwards later.
8. Status → `Review` in both systems. Bump `updated:`.
9. Report the item count and what the automated suites are covering, so the reviewer knows what the plan deliberately omits.
