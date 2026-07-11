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
}

export interface PostDropHook {
	/** Repo alias (resolved via local settings) used as working directory. */
	repo: string;
	/**
	 * Command template run after a successful drop. Empty = disabled.
	 * Variables: {{file}}, {{from}}, {{to}}, {{cwd}} (quoted) — append `Raw`
	 * for the unquoted value, e.g. {{cwdRaw}}.
	 */
	command: string;
}

export interface BoardSettings {
	/** Vault-relative folders scanned for cards. */
	sourceFolders: string[];
	/** Frontmatter property that holds the column value. */
	statusProperty: string;
	/** Ordered list of columns. Unknown statuses get appended as extra columns. */
	columns: ColumnConfig[];
	/** Frontmatter property shown before the file name on each card (e.g. a ticket id). */
	titleProperty: string;
	/** Frontmatter properties rendered as badges on each card. */
	badgeProperties: string[];
	postDropHook: PostDropHook;
}

export interface SharedSettings {
	board: BoardSettings;
	chips: {
		/** Tool used when a chip block does not specify one. */
		defaultTool: string;
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
		columns: [{ value: "Backlog" }, { value: "In progress" }, { value: "Done" }],
		titleProperty: "id",
		badgeProperties: ["priority", "type"],
		postDropHook: { repo: "", command: "" },
	},
	chips: {
		defaultTool: "claude",
	},
};

export const DEFAULT_LOCAL: LocalSettings = {
	repos: {},
	tools:
		process.platform === "win32"
			? { claude: { command: "wt.exe -d {{cwd}} cmd /k claude {{prompt}}" } }
			: { claude: { command: "" } },
	enableHooks: false,
	confirmBeforeRun: true,
};
