/**
 * Search metadata for the settings tab.
 *
 * Obsidian 1.13 indexes a tab's settings through `getSettingDefinitions()`;
 * a tab that doesn't implement it is invisible to the settings search, which
 * is what `obsidianmd/settings-tab/prefer-setting-definitions` warns about.
 *
 * Dispatch still RENDERS through `display()`, because that works on every
 * version it supports (minAppVersion is 1.7.2) — so this table is the same
 * names and descriptions a second time, and the two can drift. That is the
 * cost of being additive rather than migrating, and `test/settings-index.test.ts`
 * is what makes it safe: it reads the `setName()` calls out of
 * `settings-tab.ts` and fails when a setting exists in one place and not the
 * other.
 *
 * Kept free of `obsidian` imports so the test can load it directly.
 */

export interface SettingIndexEntry {
	name: string;
	desc: string;
}

export interface SettingIndexGroup {
	heading: string;
	items: SettingIndexEntry[];
}

/** One entry per setting rendered by DispatchSettingTab.display(), in order. */
export const SETTING_INDEX: SettingIndexGroup[] = [
	{
		heading: "Board",
		items: [
			{ name: "Source folders", desc: "Vault folders scanned for cards, one per line." },
			{ name: "Status property", desc: "Frontmatter property that holds the column value." },
			{ name: "Order property", desc: "Frontmatter property storing the manual sort position within a column (written on drag & drop). Leave empty to disable manual ordering." },
			{ name: "Columns", desc: "One column per line: status value | display label | milestone progress | WIP limit. Label may be empty; progress is 0–100 (how complete a card with this status counts on the Milestones tab) or - to exclude the status from milestone progress; the WIP limit highlights the column when reached (amber) or exceeded (red)." },
			{ name: "Title property", desc: "Frontmatter property shown before the file name on each card (e.g. a ticket id)." },
			{ name: "Assignee property", desc: "Frontmatter property naming the ticket's assignee — shown as an @-badge on the card and always offered in the slice-by bar. Empty = off." },
			{ name: "Badge properties", desc: "Comma-separated frontmatter properties rendered as badges on each card." },
			{ name: "Open-questions property", desc: "Numeric frontmatter property counting unanswered refinement questions. Shown as a \"? N\" badge on cards — green at 0 (refinement complete). Empty = off." },
			{ name: "Open-tests property", desc: "Numeric frontmatter property counting open manual test-plan items. Shown as a \"✓ N\" badge on cards — green at 0 (manual review complete). Empty = off." },
			{ name: "Discussion property", desc: "Frontmatter property holding a discussion URL (e.g. a Slack thread). Cards show a chat icon that opens the link. Empty = off." },
			{ name: "Required properties", desc: "Comma-separated properties every card note must carry. Missing values, unrendered template stubs, and unknown statuses appear in the board's ⚠ problems panel." },
		],
	},
	{
		heading: "Milestones",
		items: [
			{ name: "Version property", desc: "Frontmatter property that holds the target version." },
			{ name: "Planned versions", desc: "One per line, in the exact form drops should write (e.g. v1.2.0). These columns are always shown, even when empty; versions found in notes appear automatically." },
			{ name: "Size property", desc: "Numeric frontmatter property used as the ticket's weight in the progress metric. Missing or invalid values count as 1." },
			{ name: "Release notes folder", desc: "Vault folder with release notes carrying version and date frontmatter. A version column whose initial (x.y.0) note exists shows the linked release date; estimates only appear for unreleased versions." },
			{ name: "Completed property", desc: "Frontmatter property holding a completion date (e.g. deployed, stamped by an automation rule). Powers the velocity-based forecast in the milestone headers. Empty = forecast off." },
			{ name: "Velocity window (days)", desc: "Look-back window for the completion velocity behind the forecast." },
			{ name: "Version tags", desc: "One per line: major.minor = tag (e.g. 1.1 = MVP). Also editable by clicking the tag in a column header." },
		],
	},
	{
		heading: "Meetings",
		items: [
			{ name: "Meetings folder", desc: "Vault folder with meeting notes. Empty = tab hidden." },
			{ name: "Meeting properties", desc: "Date | participants | open-actions frontmatter property names." },
			{ name: "Meeting chip templates", desc: "Chips offered on meeting cards (right-click + file menu). One per line: label | tool | repo | prompt — same variables as ticket chips." },
		],
	},
	{
		heading: "Automations",
		items: [
			{ name: "Rules", desc: "" },
			{ name: "Calendar filter", desc: "Optional title filter (regex or substring) for the upcoming-events strip on the Meetings tab — e.g. Weekly|Product to hide personal events." },
			{ name: "Calendar lookahead (days)", desc: "How far ahead the upcoming-events strip looks." },
			{ name: "Calendar event chips", desc: "Chips shown on each upcoming calendar card (e.g. Prepare agenda). Same line format as chip templates; prompt variables: {{date}} (YYYY-MM-DD), {{title}} (event title)." },
		],
	},
	{
		heading: "Todos",
		items: [
			{ name: "Todo folders", desc: "Vault folders (root only) scanned for todo items, one per line. Empty = tab hidden." },
			{ name: "Todo sections", desc: "Section headings whose unchecked items count as todos (case-insensitive prefix match), one per line — keeps acceptance criteria and test plans off the board unless allowlisted." },
			{ name: "Assignees", desc: "Known assignees, one per line (e.g. team members). A bold owner label (**Alex** / **Alex:** …) counts only if it matches one, so ticket refs or dates in a bold prefix aren't mistaken for owners. Empty = accept any label." },
			{ name: "Fallback assignee", desc: "Column/label for items with no known assignee." },
		],
	},
	{
		heading: "Chips",
		items: [
			{ name: "Default tool", desc: "Tool used when a chip block does not specify one." },
			{ name: "Column chips", desc: "Batch chips offered when clicking a Kanban column header — one agent session over all tickets in the column. Same line format as chip templates; prompt variables: {{ids}} (space-separated ticket IDs in board order), {{status}}, {{count}}." },
			{ name: "Chip templates", desc: "Virtual chips shown for every card note (board right-click + file menu) — no markdown block needed. One per line: label | tool | repo | prompt. Empty tool/repo = defaults. Prompt variables: {{id}}, {{status}}, {{file}}, {{title}}." },
		],
	},
	{
		heading: "This device",
		items: [
			{ name: "Repositories", desc: "One per line: alias = absolute path on this machine." },
			{ name: "Tools", desc: "One per line: name = command template. Variables: {{cwd}}, {{prompt}}, {{promptFile}} — quoted; append Raw for the unquoted value (no promptRaw)." },
			{ name: "Calendar ICS URL", desc: "Secret iCal address for the Meetings tab's upcoming strip (Google Calendar: Settings → your calendar → Integrate calendar → Secret address in iCal format). Credential-like — stored device-local, never synced." },
			{ name: "Enable automation commands on this device", desc: "Off by default — shared automation commands only run where this is enabled (frontmatter 'set' assignments always apply)." },
			{ name: "Confirm before running a chip", desc: "Show the exact command in a dialog before launching a tool." },
		],
	},
];
