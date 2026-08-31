---
description: Write the manual test plan for a code-complete ticket — only what automation can't cover — set open_tests, freeze the contract zone, move to review.
argument-hint: <ticket id>
---

# /test-plan $ARGUMENTS

Writes the manual test plan and performs the `<<S_DEV>>` → `<<S_REVIEW>>` transition. `$ARGUMENTS` is the ticket id.

## Prepare

1. Resolve the ticket (spec via `id: $ARGUMENTS` in `<<WIKI>>/<<TICKETS>>`, task in <<TRACKER>>) and name the session `$ARGUMENTS <short name>`.
2. **Preconditions:** the ticket is code-complete in `<<S_DEV>>` and the gates are green. This command performs the status move, so verify rather than assume — run them if unsure:
   ```
   <<GATES>>
   ```

## Analyze automated coverage

3. Identify what the change actually touched, then what the suites already assert for it. **Anything asserted automatically does not belong in the manual plan.** The plan's whole value is being the complement of the test suite — a checklist that re-verifies what CI already proves trains reviewers to tick boxes without looking.
4. What is left is typically: visual and layout verification, platform- or device-specific behaviour, permissions and other real-environment interactions, flows that need a real account or real data, timing and interruption behaviour, and anything a store or compliance reviewer will try by hand.
5. **Do it yourself, wherever you can.** Before a candidate earns a place in the checklist, ask whether you can already perform it with the tools you have — running a script, reading a file, checking git or filesystem state, inspecting JSON, calling an API. If you can, run it now rather than deferring it to the reviewer; that isn't a manual-plan item, it's already verified, and it belongs in your report, not in a `- [ ]` box someone would only be redoing. What survives is the genuinely human-only slice: GUI interaction and visual judgment, an account or credential only the reviewer holds, a physical device, or something that spans real wall-clock time. A check you ran yourself that turned up wrong is a finding, not a passing box — report it (and fix it, if it's yours to fix) rather than folding it into the plan as if it passed.

## Write the plan

6. Replace the spec's `## Test plan` section (record zone) and strip its `<!-- GUIDE: … -->`. Structure: one line naming the change and the build it applies to, then a `- [ ]` checklist of what step 5 left. **Every item must be executable by someone without this session's context** — concrete starting point, concrete action, concrete expected result. "Check the settings screen works" is not an item. Assign a tester with a bold prefix (`**Name:**`) where it matters.
7. Set `open_tests:` to the number of checklist items. It is the `✓ N` badge and the gate out of review: reviewers tick items and decrement it, `0` means manual review is complete.

## Freeze and move

8. **Stamp `frozen:` with today's date** (confirm with `date`). The ticket now leaves development, so the contract zone — goal/symptom, acceptance criteria, open questions and their answers, scope, implementation plan — is closed. From here, new information is a dated entry in the record zone, and a wrong frozen statement gets an annotation beneath it rather than a rewrite. Stamping it here, rather than at review time, means the boundary survives the card being dragged backwards later.
9. Status → `<<S_REVIEW>>` in both systems. Bump `updated:`.
10. Report the item count, what the automated suites are covering, and what you verified yourself in step 5 — so the reviewer knows what the plan deliberately omits and why.
