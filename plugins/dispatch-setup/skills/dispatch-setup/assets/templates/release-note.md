---
version:
date:
status: planned
owner:
---
<!-- GUIDE — frontmatter. THE RELEASE PLAN TAB PARSES `version` AND `date`.
  version  the canonical write form, matching `milestones.plannedVersions` exactly
           (e.g. v1.4.0). A note for x.y.0 links from the version line; each x.y.z
           links from its patch column when the line is expanded. A malformed or
           missing value silently drops this release from the board.
  date     YYYY-MM-DD, the day it shipped. Shown instead of a forecast once released.
  status   planned | released.
  owner    the accountable person.
  Delete this block once written.
-->

# <version>

<!-- GUIDE: One or two lines — what this release is about. -->

## What shipped

<!-- GUIDE: A link per ticket, grouped if it helps. LINK, don't restate: the tickets
     carry the detail, and a summary here is a second version of the truth that will
     disagree with the first one. Generated from the board — every ticket whose
     version_target matches this version. -->

## Not in this release

<!-- GUIDE: What was deliberately deferred, and to which version. The Release Plan
     shows where it went; this says why. -->

## Build

<!-- GUIDE: Build numbers, commit/tag, environment and anything needed to identify
     exactly this artifact later. -->

## Notes

<!-- GUIDE: Migrations, breaking changes, anything an operator or support person needs.

     Release notes are events: they were true on their date and never become untrue,
     so they carry no currency marker and are never revised. They are the fastest way
     to answer "when did this behaviour change?" — which is why the ticket links are
     the important part. -->
