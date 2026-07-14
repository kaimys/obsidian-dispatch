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
	/** Frontmatter properties rendered as badges on each card. */
	badgeProperties: string[];
	/**
	 * Properties every card note must carry (non-empty, no unrendered template
	 * stubs). Violations appear in the board's problems panel.
	 */
	requiredProperties: string[];
	/** Rules evaluated when a card enters a column. */
	automations: AutomationRule[];
}

export interface SharedSettings {
	board: BoardSettings;
	milestones: MilestoneSettings;
	chips: {
		/** Tool used when a chip block does not specify one. */
		defaultTool: string;
		/**
		 * Virtual chips rendered for every card note (board context menu +
		 * file menu) — computed from frontmatter, no markdown block needed.
		 */
		templates: ChipTemplate[];
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
		badgeProperties: ["priority", "type"],
		requiredProperties: [],
		automations: [],
	},
	milestones: {
		versionProperty: "version",
		plannedVersions: [],
		tags: {},
		sizeProperty: "size",
	},
	chips: {
		defaultTool: "claude",
		templates: [],
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
	enableHooks: false,
	confirmBeforeRun: true,
};
