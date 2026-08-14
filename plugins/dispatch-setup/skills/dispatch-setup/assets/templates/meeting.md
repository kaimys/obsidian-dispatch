---
date:
participants: []
discussion:
decisions_folded:
open_items: 0
---
<!-- GUIDE — frontmatter. Delete this block once written.
  date              YYYY-MM-DD. The file is named `YYYY-MM-DD - <meeting>.md`.
  participants      list — feeds the Meetings tab.
  discussion        permalink of the thread where the agenda was announced.
  decisions_folded  the date the decisions were written into the tickets they affect.
                    Empty means the outcomes haven't landed yet — the one genuinely
                    checkable state a meeting note has.
  open_items        number of unchecked action items — the card badge.
-->

# <YYYY-MM-DD> — <meeting>

## Agenda

<!-- GUIDE: Built from the board before the meeting — open refinement questions that
     are actually blocking, tickets awaiting manual sign-off, what blocks the next
     release, and unfolded decisions from last time. Name what is being DECIDED and
     who decides it; an agenda of topics produces a meeting of topics. -->

## Summary

<!-- GUIDE: Written after, from the transcript in the sources folder together with the
     thread — the thread usually carries the context the transcript lacks. -->

## Decisions

<!-- GUIDE: One per decision: what was decided, by whom, and the ticket ids it affects.
     Then fold each into those tickets and stamp `decisions_folded:`. A decision that
     lives only here has to be rediscovered by whoever next opens the ticket, and won't
     be. On a frozen ticket, append to the record zone instead of editing the contract. -->

## Action items

<!-- GUIDE: THE TODOS TAB PARSES THIS SECTION. Keep the exact format: `- [ ]` checkbox
     lines, with the owner as a bold line above a group or as an inline `**Name:**`
     prefix. Prose ("Alex will look into X") is invisible to the board. The section
     heading must stay in the configured allowlist. Keep `open_items:` equal to the
     number of unchecked lines. -->

**<Name>**

- [ ] <action> <!-- ticket id if it has one -->

## Notes

<!-- GUIDE: Everything else worth keeping. Meeting notes are never authoritative —
     durable outcomes get promoted into tickets or ADRs; this stays as the record of
     when it was said. -->
