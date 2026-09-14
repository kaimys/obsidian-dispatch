---
description: Fix a small bug from a report, with a durable ticket and verified result; stop when the full workflow is warranted.
argument-hint: <report or source URL>
---

# Workflow: fix-bug

Read `dispatch/invariants.md` first. `<ARGS>` is the report supplied by the invoking
agent stub. This shortcut requires an explicit request to use `/fix-bug` (or the
agent's equivalent invocation); do not choose it just because a report looks small.

Tracker: <<TRACKER>>. Chat: <<CHAT>>. If either is `none`, skip only that
integration's operations and missing-side preconditions. A configured but unavailable
integration is an error, not `none`. With no chat, ask the requester directly.

## Intake and suitability

1. Confirm today's date. Read the report, its evidence and the affected code. Search
   `<<WIKI>>/<<TICKETS>>` and the configured tracker for the same bug, including closed
   tickets. If one exists, report its link and stop without creating a duplicate,
   editing a frozen contract or reopening it. If this is an explicitly requested retry
   of a recorded tracker synchronization failure, retry only the failed operation on
   that existing issue; do not fix or create the ticket again.
2. Before changing code, answer: **is running refinement, implementation planning,
   development, independent code review and a manual test plan worthwhile for this
   bug?** The shortcut fits a known cause, a small blast radius and a verifiable
   outcome, usually a one-file wording or layout correction. File count is a clue,
   not proof: a one-line data migration can still require the full workflow.
3. Create a bug ticket even if the answer calls for the full workflow. Use
   `<<WIKI>>/<<TEMPLATES>>/ticket-bug.md`, with IDs from `<<ID_SCHEME>>` (highest
   existing + 1, checking both systems). Resolve `owner` and `assignee` from the
   requester/source and team directory. Fill symptom, reproduction, environment,
   known root cause or what is unknown, scope, criteria, source links and actual
   questions; start in `<<S_NEW>>`. Leave `open_tests` and `open_findings` empty.
   Set the target version when established by the project/report; do not guess it.
   Create the matching tracker task when configured and store its reference.
   Register the note in the wiki's index/log. Retain source evidence and remove
   GUIDE scaffolding only from filled sections. Do all this **before editing code**.
4. If the full workflow is warranted, warn the requester and leave the ticket in
   `<<S_REFINEMENT>>` with its questions and tracker state accurate. Stop; suggest
   refinement of that ticket. If intake/tracker creation failed, retain any created
   note, report the missing side and stop instead of beginning a one-sided fix.

## Fix and verify

5. Pull the default branch and create a ticket branch using the project's normal
   development practice. The explicit shortcut request authorizes starting work after
   the checks above. Move to `<<S_DEV>>` in the note and tracker. Record a short
   implementation approach in the ticket before editing.
6. Make the smallest change that addresses the known cause. If investigation expands
   the scope, reveals uncertainty or needs a product decision, **stop editing**.
   Record the findings and any code already written, leave the ticket in
   `<<S_REFINEMENT>>` in both systems, and warn that the full workflow is needed.
7. Run the configured gates and verify the original reproduction:

   ```
   <<GATES>>
   ```

   Add a regression test when it can assert the changed behavior meaningfully. For
   a wording/layout fix, direct inspection may be better than a test repeating a
   string. A failed gate or reproduction keeps the ticket in `<<S_DEV>>`; record
   the failure and stop before completion. Do not classify a failure as unrelated
   without evidence, or weaken tests to pass.
8. Record the files, build/commit and exact checks/results under As-built notes.
   Write Test plan/results with a coverage assessment: which checks ran, and what
   still requires a human. Set `open_tests` to the actual outstanding count, including
   `0` when that assessment finds none. If a visual judgment or inaccessible check
   remains, leave a concrete unchecked item and keep the ticket in `<<S_DEV>>`.
   Explain the required hand-off; do not claim the check passed.
9. Record that this was an explicitly requested small-bug shortcut and that the
   independent review was omitted. Leave `open_findings` empty in that case. Do not
   invent a Code review entry or write `0` to bypass a gate. Do not invoke
   `/test-plan` without its separate-review precondition.

## Complete the durable record

10. Complete only when the cause remains small and understood, `open_questions: 0`,
    gates and reproduction passed, and `open_tests: 0` is backed by the recorded
    assessment. If `version_target` is unknown, ask the requester and leave the
    ticket open rather than claiming it will appear in release notes. Commit the
    fix with its ticket ID; record the branch/commit and finalized contract.
11. Stamp `frozen: <today>` before leaving development. Write `<<S_DONE>>`,
    `<<P_COMPLETED>>: <today>` and `updated: <today>` directly, then mirror the
    tracker. A frontmatter write does not trigger board drag automations. The release
    workflow selects this completed ticket by `version_target`; do not run release,
    tag, publish or merge as part of this shortcut.
12. If tracker synchronization fails, keep the durable completion/verification
    record and report the exact pending operation and existing issue reference.
    This is **partial synchronization, not a successful run**. A retry reconciles
    that issue to the wiki; it does not duplicate the bug or rewrite frozen sections.
    On success, report the ticket, commit, verified result and any deliberately
    omitted independent review. Update the wiki's log/index where required.
