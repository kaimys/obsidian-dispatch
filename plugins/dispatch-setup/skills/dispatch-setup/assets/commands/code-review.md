---
description: Review a ticket's branch against its acceptance criteria, plan and code — findings with file, line and fix, recorded in the ticket — and send the card back when a criterion fails.
argument-hint: <ticket id>
---

# /code-review $ARGUMENTS

Reviews the code built for one ticket and records the review in the ticket. `$ARGUMENTS` is the ticket id.

## Resolve

1. Resolve the ticket (spec via `id: $ARGUMENTS` in `<<WIKI>>/<<TICKETS>>`, task in <<TRACKER>>) and name the session `$ARGUMENTS <short name>`. Confirm today's date with `date`.
2. **The reviewer is not the author.** If this session wrote any of the code under review, stop and say so: a context that produced the code is the context that will defend it, and the review has to come from one that reads only the ticket and the diff. A chip launch is a fresh session by construction; a terminal session that just finished `/develop` is not.
3. **Find the change.** The branch is the current one unless the ticket's as-built notes name another; the range is the default branch to `HEAD`; the commit reviewed is `HEAD`'s short sha and goes into the entry's heading, so a later reader knows which build the findings describe. If a pull request is open on the branch, its body and any reviews already posted on it are input, to be folded rather than repeated.
4. **Preconditions:** the ticket is in `<<S_REVIEW>>`, or in `<<S_DEV>>` when the review was asked for explicitly. A ticket that has not reached development has no code to review; say so and stop.

## Read

5. **The ticket first, all of it.** The contract zone — acceptance criteria, decisions, the plan with every revision block and annotation — is what the code is measured against; the record zone — as-built notes, test plan, earlier reviews — is what the author already knows went differently. Then the ADRs it links (`<<WIKI>>/<<DECISIONS>>`), and the invariants in the repository's `CLAUDE.md`.
6. **Then the diff, in full.** The commit log for the shape of the work, the diff stat for its extent, then every new file read whole and every changed file read around its hunks. Tests are part of the diff, not an appendix: read what they assert before judging what the code does.
7. **Run the gates yourself:**
   ```
   <<GATES>>
   ```
   A green suite is a fact to report; a red one is the first finding. Never take the PR body's word for either.

## Review

8. Work through these lenses in order, because each one catches what the next would otherwise misattribute:
   - **Acceptance criteria, one by one.** Does the code satisfy each *as written*? A criterion the code no longer satisfies literally is a finding even when the code is right — the spec drifted from the build, and a spec that can drift makes every later spec↔code mismatch unexplainable. Name the criterion and which side should move.
   - **Plan versus built.** Where the implementation left the plan, is there a dated as-built entry saying so? A pivot recorded only in commit messages or a PR body is a finding: the ticket is the record, git is not.
   - **Defects.** For each: the file and line, the concrete inputs or state that trigger it, what happens instead of what should, and the fix. No defect without a failure scenario — "this looks fragile" is not a finding.
   - **Seams.** Look hardest where the change meets code it did not write: a setting one side writes and the other overwrites, an environment variable documented as injected and never set, a message that names a flag that no longer exists. Seam defects are the ones a green suite cannot see, because each side's tests assume the other.
   - **Tests.** What the suite asserts against what actually bit during development (the as-built notes say). Name each gap with the case that would close it, not with "needs more tests".
   - **Drift in words.** User-facing messages first, then comments, then docs: anything describing a path that no longer exists. Cheap to fix, expensive to leave — it is what sends the next reader down a removed code path.
   - **Invariants.** Whatever the repository's `CLAUDE.md` declares must always hold, plus the ADRs the ticket links.
   - **Branch hygiene.** Commits that belong to another ticket, or to none.
9. **Rank by severity, verdict first.** Blocking: a defect a user would hit, a failed acceptance criterion, an invariant broken. Then what should be fixed before merge but fails nothing. Then what can wait. Say plainly whether the ticket can leave `<<S_REVIEW>>` as it stands.
10. **Name what is good and should stay** — specifically, with the reason. A review that lists only defects teaches the next author to hide the design; naming the decision that held up under pressure is how it survives the next refactor.

## Record

11. **Write it into the ticket.** The record zone gets a `## Code review` section between `## As-built notes` and `## Follow-ups` — create it if absent, append to it if present. One dated entry per review: `### <YYYY-MM-DD> — branch <name> at <sha>`, then scope and gates, the verdict, the findings numbered in severity order, what is good, and a short "before this leaves review" list. Findings that reach the ticket's contract zone are recorded here, never applied there: a stale acceptance criterion is a finding for the author or `/update-ticket`, and on a frozen ticket it becomes an annotation beneath the line, not a rewrite.
12. **A failed acceptance criterion sends the card back.** Status → `<<S_DEV>>` in both systems, with a dated as-built entry naming the findings that failed it. A review whose findings fail no criterion leaves the card in `<<S_REVIEW>>` and touches nothing else — `open_tests` is the test plan's counter, not the review's, and the review ticks no test-plan items.
13. **Fix nothing in this session.** The fix is a `/develop` session, and a different one from this — for the same reason the review had to be. Recording the fix list as a plan step, so the next session starts from it rather than from the prose, is the reviewer's job; making the changes is not.
14. **The ticket is the record; the pull request is a mirror.** Post to the PR only when asked, and then one comment with the verdict and a pointer to the ticket, not the findings copied. Bump `updated:`.

## Close

15. Report the verdict, the number of blocking and non-blocking findings, and what happens next: which session fixes what, whether the contract zone needs `/update-ticket` first, and that `/test-plan` re-runs after the fixes so the freeze is re-stamped against the commit that ships.
16. **Stop instead of guessing** when a finding turns on a product decision, or when the code and the ticket disagree and neither side is obviously wrong. Record the disagreement as a finding with both readings, and say what decision would resolve it.
