/**
 * Dispatch has two configuration layers:
 *
 * - SharedSettings — stored in the vault's data.json via Obsidian's normal
 *   plugin-settings mechanism. Travels with the vault (sync/git), so it must
 *   never contain machine-specific absolute paths. Repositories are referenced
 *   by ALIAS only.
 *
 * - LocalSettings — stored in local.json next to the plugin, meant to be
 *   excluded from vault sync / git. Maps repo aliases to absolute paths on
 *   this machine and defines which tool commands exist here.
 */

export interface ColumnConfig {
	/** The raw status value as it appears in frontmatter. */
	value: string;
	/** Optional display label; defaults to the value. */
	label?: string;
	/** Completion (0–100) that this status contributes to milestone progress. */
	progress?: number;
	/** Exclude cards with this status from milestone progress (e.g. Rejected). */
	excluded?: boolean;
	/** WIP limit — the column highlights when the card count reaches/exceeds it. */
	wip?: number;
}

export interface MilestoneSettings {
	/** Frontmatter property that holds the target version. */
	versionProperty: string;
	/**
	 * Versions always shown as columns, in their canonical write form
	 * (e.g. "v1.2.0"). Dropping a card writes this exact value; columns are
	 * keyed/grouped by the normalized major.minor.
	 */
	plannedVersions: string[];
	/** Optional tag per version (MVP, Closed Beta, …), keyed by major.minor. */
	tags: Record<string, string>;
	/** Frontmatter property with the ticket size/weight (numeric). Missing/invalid = 1. */
	sizeProperty: string;
	/**
	 * Frontmatter property holding a completion date (e.g. "deployed").
	 * Powers the velocity-based milestone forecast. Empty = forecast off.
	 */
	completedProperty: string;
	/** Look-back window (days) for the velocity calculation. */
	velocityWindowDays: number;
	/**
	 * Vault folder containing release notes with `version` and `date`
	 * frontmatter. A version column whose initial (x.y.0) release note exists
	 * shows the linked release date instead of a forecast. Empty = off.
	 */
	releaseNotesFolder: string;
}

export interface AutomationRule {
	/** Status values that trigger this rule when a card ENTERS them; empty = any status change. */
	when: string[];
	/**
	 * Frontmatter assignments applied atomically with the status write.
	 * Values support {{date}}, {{datetime}}, {{from}}, {{to}}.
	 */
	set: Record<string, string>;
	/**
	 * Optional command template, run in the repo alias below. Variables:
	 * {{file}}, {{from}}, {{to}}, {{cwd}} (quoted; append Raw for unquoted).
	 * Commands only run on devices that enabled automations locally.
	 */
	command: string;
	/** Repo alias (resolved via local settings) for the command's working directory. */
	repo: string;
}

export interface ChipTemplate {
	label: string;
	/** Tool name; empty = the shared default tool. */
	tool?: string;
	/** Repo alias; empty = vault folder. */
	repo?: string;
	/** Prompt template. Variables: {{id}}, {{status}}, {{file}}, {{title}}, {{vault}}. */
	prompt: string;
}

export interface BoardSettings {
	/** Vault-relative folders scanned for cards. */
	sourceFolders: string[];
	/** Frontmatter property that holds the column value. */
	statusProperty: string;
	/**
	 * Frontmatter property that stores the manual sort position within a
	 * column (numeric, written on drag & drop). Empty string disables manual
	 * ordering — cards are then sorted by title and drops only change status.
	 */
	orderProperty: string;
	/** Ordered list of columns. Unknown statuses get appended as extra columns. */
	columns: ColumnConfig[];
	/** Frontmatter property shown before the file name on each card (e.g. a ticket id). */
	titleProperty: string;
	/** Frontmatter property naming the ticket's assignee — rendered as an
	 * @-badge and always offered in the slice-by bar. Empty = off. */
	assigneeProperty: string;
	/** Frontmatter properties rendered as badges on each card. */
	badgeProperties: string[];
	/**
	 * Numeric frontmatter property counting unanswered refinement questions.
	 * Rendered as a "? N" badge (green at 0 = refinement complete). Empty = off.
	 */
	questionsProperty: string;
	/**
	 * Frontmatter property holding a discussion URL (Slack/Teams/forum thread).
	 * Rendered as a chat icon on the card that opens the link. Empty = off.
	 */
	discussionProperty: string;
	/**
	 * Numeric frontmatter property counting open manual test-plan items.
	 * Rendered as a "✓ N" badge (green at 0 = manual review complete). Empty = off.
	 */
	testsProperty: string;
	/**
	 * Properties every card note must carry (non-empty, no unrendered template
	 * stubs). Violations appear in the board's problems panel.
	 */
	requiredProperties: string[];
	/** Rules evaluated when a card enters a column. */
	automations: AutomationRule[];
}

export interface MeetingSettings {
	/** Vault folder (root only — subfolders ignored) with meeting notes. Empty = tab hidden. */
	folder: string;
	/** Frontmatter property with the meeting date (YYYY-MM-DD). */
	dateProperty: string;
	/** Frontmatter property listing participants. */
	participantsProperty: string;
	/** Numeric frontmatter property counting open action items (card badge). */
	actionsProperty: string;
	/** Chips offered on meeting cards (e.g. "Read transcript" → /meeting report). */
	templates: ChipTemplate[];
	/** Optional title filter (regex or substring) for the upcoming-events strip. */
	calendarFilter: string;
	/** How far ahead the upcoming-events strip looks. */
	calendarLookaheadDays: number;
	/** Chips on upcoming calendar cards. Prompt variables: {{date}}, {{title}}. */
	calendarChips: ChipTemplate[];
}

export interface TodoSettings {
	/**
	 * Vault folders (root only) scanned for todo items. Empty = tab hidden.
	 */
	folders: string[];
	/**
	 * Section headings (case-insensitive prefix match) whose unchecked
	 * `- [ ]` items count as todos — scoping keeps acceptance criteria and
	 * test plans off the board unless explicitly allowlisted.
	 */
	sections: string[];
	/**
	 * Known assignees (e.g. team members). A bold owner label counts only if
	 * it matches one (by full or first-word match), so ticket refs / dates in
	 * a `**…:**` prefix aren't mistaken for owners. Empty = accept any label.
	 */
	assignees: string[];
	/** Column/label for items with no known assignee (e.g. "Team"). */
	fallbackAssignee: string;
}

export interface SharedSettings {
	board: BoardSettings;
	milestones: MilestoneSettings;
	meetings: MeetingSettings;
	todos: TodoSettings;
	chips: {
		/** Tool used when a chip block does not specify one. */
		defaultTool: string;
		/**
		 * Virtual chips rendered for every card note (board context menu +
		 * file menu) — computed from frontmatter, no markdown block needed.
		 */
		templates: ChipTemplate[];
		/**
		 * Batch chips on Kanban column headers — one agent session over all
		 * tickets in the column. Prompt variables: {{ids}} (space-separated
		 * ticket IDs, board order), {{status}}, {{count}}.
		 */
		columnTemplates: ChipTemplate[];
	};
}

export interface ToolConfig {
	/**
	 * Command template that launches the tool. Variables: {{cwd}}, {{prompt}},
	 * {{promptFile}} (all quoted) — append `Raw` for the unquoted value.
	 */
	command: string;
}

export interface LocalSettings {
	/** Repo alias -> absolute path on this machine. */
	repos: Record<string, string>;
	/** Tool name -> launch command template on this machine. */
	tools: Record<string, ToolConfig>;
	/**
	 * Secret iCal URL (e.g. Google Calendar's "Secret address in iCal format")
	 * for the Meetings tab's upcoming strip. Credential-like — device-local.
	 */
	calendarUrl: string;
	/** Whether the shared post-drop hook may run on this machine. */
	enableHooks: boolean;
	/** Show a confirmation dialog (with the exact command) before running a chip. */
	confirmBeforeRun: boolean;
}

export const DEFAULT_SHARED: SharedSettings = {
	board: {
		sourceFolders: [],
		statusProperty: "status",
		orderProperty: "rank",
		columns: [
			{ value: "Backlog", progress: 0 },
			{ value: "In progress", progress: 50 },
			{ value: "Done", progress: 100 },
		],
		titleProperty: "id",
		assigneeProperty: "",
		badgeProperties: ["priority", "type"],
		questionsProperty: "",
		discussionProperty: "",
		testsProperty: "",
		requiredProperties: [],
		automations: [],
	},
	milestones: {
		versionProperty: "version",
		plannedVersions: [],
		tags: {},
		sizeProperty: "size",
		completedProperty: "",
		velocityWindowDays: 28,
		releaseNotesFolder: "",
	},
	meetings: {
		folder: "",
		dateProperty: "meeting_date",
		participantsProperty: "participants",
		actionsProperty: "open_actions",
		templates: [],
		calendarFilter: "",
		calendarLookaheadDays: 14,
		calendarChips: [],
	},
	todos: {
		folders: [],
		sections: ["Action items", "Open action items"],
		assignees: [],
		fallbackAssignee: "Team",
	},
	chips: {
		defaultTool: "claude",
		templates: [],
		columnTemplates: [],
	},
};

export const DEFAULT_LOCAL: LocalSettings = {
	repos: {},
	tools:
		// `start` respects the user's default terminal and, unlike wt.exe,
		// does not parse ";" inside arguments as a tab separator.
		process.platform === "win32"
			? { claude: { command: 'start "Dispatch" /d {{cwd}} cmd /k claude {{prompt}}' } }
			: { claude: { command: "" } },
	calendarUrl: "",
	enableHooks: false,
	confirmBeforeRun: true,
};
