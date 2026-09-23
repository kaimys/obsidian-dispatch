import obsidianmd from "eslint-plugin-obsidianmd";

// The rule splits sentences at e.g. and x.y.0, and cannot preserve a quoted
// Google Calendar navigation path. Match only these existing descriptions;
// edits to their wording will be checked again.
const literalDescriptions = [
	"Frontmatter property shown before the file name on each card (e.g. a ticket id).",
	"Frontmatter property holding a discussion URL (e.g. a Slack thread). Cards show a chat icon that opens the link. Empty = off.",
	"One per line, in the exact form drops should write (e.g. v1.2.0). These columns are always shown, even when empty; versions found in notes appear automatically.",
	"Vault folder with release notes carrying version and date frontmatter. A version column whose initial (x.y.0) note exists shows the linked release date; estimates only appear for unreleased versions.",
	"Frontmatter property holding a completion date (e.g. deployed, stamped by an automation rule). Powers the velocity-based forecast in the milestone headers. Empty = forecast off.",
	"Optional title filter (regex or substring) for the upcoming-events strip on the Meetings tab — e.g. Weekly|Product to hide personal events.",
	"Known assignees, one per line (e.g. team members). A bold owner label (**Alex** / **Alex:** …) counts only if it matches one, so ticket refs or dates in a bold prefix aren't mistaken for owners. Empty = accept any label.",
	"Secret iCal address for the Meetings tab's upcoming strip (Google Calendar: Settings → your calendar → Integrate calendar → Secret address in iCal format). Credential-like — stored device-local, never synced."
];
const exactPattern = (text) => `^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;

export default [
	{ ignores: ["main.js", "node_modules/**", "docs/**", "dispatch/wiki/**", "test/**", "*.config.*", "plugins/**"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", {
				// Extend the vocabulary without replacing the rule's built-in brands/acronyms.
				ignoreWords: ["Dispatch", "Code", "Codex", "Calendar", "iCal", "IDs", "MVP", "WIP", "ICS", "N", "Alex", "Robin", "Morgan", "Milestones", "Meetings"],
				// These are literal examples, not prose. Anchor exceptions so ordinary
				// labels and descriptions continue to be checked.
				ignoreRegex: [
					...literalDescriptions.map(exactPattern),
					"^MVP, Closed beta, …$",
					"^(?:assignee|open_questions|open_tests|open_findings|discussion|deployed)$",
					"^id, status, updated$",
					"^\\d{2}_[\\w/-]+(?:\\n\\d{2}_[\\w/-]+)*$",
					"^Backlog \\| \\| 0\\nIn progress \\| Doing \\| 50 \\| 5\\nDone \\| \\| 100\\nRejected \\| \\| -$",
					"^Action items\\nOpen action items$",
					"^my-project = C:\\\\Users\\\\me\\\\Workspace\\\\my-project$",
					"^codex = \\$$",
				],
			}],
		},
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
	},
	{
		// `dispatch/scripts/` is Node, not plugin code — it is never bundled and never runs
		// inside Obsidian, so `requestUrl` (an Obsidian API) does not exist there
		// and `fetch` is the correct call. The recommended ruleset assumes every
		// file is plugin code; this is the same mismatch that makes these scripts
		// write through `process.stdout` instead of `console`.
		files: ["dispatch/scripts/**/*.mjs"],
		rules: { "no-restricted-globals": "off" },
	},
];
