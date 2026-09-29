# Website fixture wiki

Two small vaults for `test/website.test.ts` (ADR-0016). `clean/` is what a real vault looks like:
ready articles next to drafts, an article with no status and one with a mistyped `Ready`, a
release note without a body and a planned one. It must build. `broken/` carries one mistake per
note, each the kind a person actually makes; every one must fail the build with its file and line.
