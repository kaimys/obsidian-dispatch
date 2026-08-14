---
id:
type: story
status: "<<S_NEW>>"
priority: medium
rank: 1000
version_target:
size:
assignee:
open_questions: 0
open_tests: 0
discussion:
updated:
<<P_COMPLETED>>:
frozen:
---
<!-- GUIDE — frontmatter. Delete this block once the ticket is created.
  id              <<ID_SCHEME>>. Mandatory: a ticket without one drops out of every batch chip.
  type            story | bug | security | task — card badge.
  status          quote it, values contain spaces. Written by the board on drag & drop.
  priority        card badge and slice-by.
  rank            manual position within the column; drag & drop rewrites it.
  version_target  groups the card on the Release Plan. Empty = unscheduled.
  size            numeric weight for progress and the velocity forecast. Missing = 1.
  assignee        @-badge on the card.
  open_questions  unanswered items in ## Open questions. The `? N` badge — 0 is the gate out of refinement.
  open_tests      unticked items in ## Test plan. The `✓ N` badge — 0 is the gate out of review.
  discussion      permalink of the thread where the team discussed this; rendered as a chat icon.
  updated         bump on every meaningful edit.
  <<P_COMPLETED>>  stamped automatically when the card enters the final column; feeds the forecast.
  frozen          stamped when the ticket leaves development — see the zone markers below.
-->

<!-- GUIDE: one paragraph — what changes and why, readable without opening anything else. -->

<!-- ═══════════ CONTRACT ZONE ═══════════
     What the implementation is built against. Freely editable until `frozen:` is
     stamped; read-only afterwards. After the freeze, new information goes into the
     record zone, and a wrong statement here gets an annotation beneath it
     (`> ⚠️ Correction <date>: …`) — never a rewrite. The wrong sentence stays
     visible, because that is what the code was built on.
     ═══════════════════════════════════════ -->

## User story

<!-- GUIDE: As a <role>, I want <capability>, so that <benefit>. -->

## Context

<!-- GUIDE: Why now, what it builds on, what it depends on. Link the wiki pages it
     derives from and the code it touches. This is what stops refinement starting from zero. -->

## Scope

<!-- GUIDE: Concretely what changes — modules, screens, contracts. -->

## Out of scope

<!-- GUIDE: What a reader would reasonably assume is included but isn't. This is the
     section that prevents scope drift during development. -->

## Open questions

<!-- GUIDE: `- [ ]` per question. Record each answer inline with who decided and when —
     the answer is the durable artifact, the thread is not. Keep `open_questions:` equal
     to the number still unanswered. -->

## Acceptance criteria

<!-- GUIDE: Testable statements, each checkable by someone without this ticket's history. -->

## Implementation plan

<!-- GUIDE: Written by /implementation-plan — ordered steps, files, risks, verification,
     and the reason behind any order that matters. -->

<!-- ═══════════ RECORD ZONE ═══════════
     What actually happened. Always appendable, including after the freeze.
     ═══════════════════════════════════ -->

## Test plan

<!-- GUIDE: Written by /test-plan — `- [ ]` manual checks only, excluding what the
     automated suites already assert. Keep `open_tests:` in sync as items are ticked. -->

## As-built notes

<!-- GUIDE: Where the implementation deviated from the plan, and why. Dated entries. -->

## Follow-ups

<!-- GUIDE: Links to the tickets that carry the deferred work. New scope is a new
     ticket, linked both ways — a finished ticket is not superseded, it is finished. -->

## References

<!-- GUIDE: Wiki pages, ADRs, threads, commits, PRs, stored images. -->

## Dispatch runs

<!-- GUIDE: Appended automatically by the run-lifecycle hook when an agent session ends. -->
