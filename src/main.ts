import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { FileSystemAdapter, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./board";
import { launchChip, registerChipProcessor } from "./chips";
import { DispatchSettingTab } from "./settings-tab";
import {
	DEFAULT_LOCAL,
	DEFAULT_SHARED,
	LocalSettings,
	SharedSettings,
} from "./settings";

const LOCAL_SETTINGS_FILE = "local.json";

export default class DispatchPlugin extends Plugin {
	shared: SharedSettings = DEFAULT_SHARED;
	local: LocalSettings = DEFAULT_LOCAL;

	async onload(): Promise<void> {
		await this.loadAllSettings();

		this.registerView(VIEW_TYPE_BOARD, (leaf) => new BoardView(leaf, this));
		this.addRibbonIcon("kanban", "Open Dispatch board", () => void this.activateBoard());
		this.addCommand({
			id: "open-board",
			name: "Open board",
			callback: () => void this.activateBoard(),
		});
		registerChipProcessor(this);
		this.addSettingTab(new DispatchSettingTab(this.app, this));

		// Virtual chips in the note's file menu for every card note.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				const folders = this.shared.board.sourceFolders
					.map((f) => f.replace(/^\/+|\/+$/g, ""))
					.filter((f) => f.length > 0);
				if (!folders.some((folder) => file.path.startsWith(folder + "/"))) return;
				for (const template of this.shared.chips.templates) {
					menu.addItem((item) =>
						item
							.setTitle(`Dispatch: ${template.label}`)
							.setIcon("zap")
							.onClick(() => launchChip(this, template, file.path))
					);
				}
			})
		);
	}

	async activateBoard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD);
		let leaf: WorkspaceLeaf;
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = this.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_BOARD, active: true });
		}
		void this.app.workspace.revealLeaf(leaf);
	}

	getVaultBasePath(): string {
		const adapter = this.app.vault.adapter;
		return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
	}

	/**
	 * Device-local settings live OUTSIDE the vault (in the user profile), so
	 * vault sync (Google Drive, Obsidian Sync, git) never sees machine paths
	 * and team members can't overwrite each other's device config. The file is
	 * keyed by vault name + a hash of the vault's absolute path, so multiple
	 * vaults on one machine stay separate.
	 */
	localSettingsPath(): string {
		const name = this.app.vault.getName().replace(/[^\w.-]+/g, "_");
		const base = this.getVaultBasePath() || name;
		let hash = 5381;
		for (let i = 0; i < base.length; i++) hash = ((hash << 5) + hash + base.charCodeAt(i)) >>> 0;
		return join(homedir(), ".dispatch", `${name}-${hash.toString(16)}.json`);
	}

	/** Pre-0.2 location inside the vault — synced, therefore wrong. */
	private legacyLocalSettingsPath(): string {
		const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
		return `${dir}/${LOCAL_SETTINGS_FILE}`;
	}

	async loadAllSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<SharedSettings> & {
			board?: Partial<SharedSettings["board"]> & {
				postDropHook?: { repo: string; command: string };
			};
		};
		this.shared = {
			board: { ...DEFAULT_SHARED.board, ...data.board },
			milestones: { ...DEFAULT_SHARED.milestones, ...data.milestones },
			chips: { ...DEFAULT_SHARED.chips, ...data.chips },
		};
		// Pre-0.3: single postDropHook — migrate into the automations list.
		const legacyHook = data.board?.postDropHook;
		if (!data.board?.automations && legacyHook?.command?.trim()) {
			this.shared.board.automations = [
				{ when: [], set: {}, command: legacyHook.command, repo: legacyHook.repo },
			];
		}
		delete (this.shared.board as { postDropHook?: unknown }).postDropHook;

		this.local = { ...DEFAULT_LOCAL };
		const path = this.localSettingsPath();
		try {
			if (existsSync(path)) {
				this.local = {
					...DEFAULT_LOCAL,
					...(JSON.parse(readFileSync(path, "utf8")) as Partial<LocalSettings>),
				};
			} else {
				await this.migrateLegacyLocalSettings(path);
			}
		} catch (e) {
			console.error("Dispatch: could not read device-local settings — using defaults", e);
		}
	}

	/** One-time move of local.json out of the vault; removes the synced copy. */
	private async migrateLegacyLocalSettings(newPath: string): Promise<void> {
		const legacy = this.legacyLocalSettingsPath();
		if (!(await this.app.vault.adapter.exists(legacy))) return;
		try {
			const parsed = JSON.parse(
				await this.app.vault.adapter.read(legacy)
			) as Partial<LocalSettings>;
			this.local = { ...DEFAULT_LOCAL, ...parsed };
			await this.saveLocal();
			await this.app.vault.adapter.remove(legacy);
			new Notice(`Dispatch: device settings moved out of the vault to ${newPath}`, 8000);
		} catch (e) {
			console.error("Dispatch: could not migrate legacy local.json — leaving it in place", e);
		}
	}

	async saveShared(): Promise<void> {
		await this.saveData(this.shared);
		this.refreshBoards();
	}

	async saveLocal(): Promise<void> {
		const path = this.localSettingsPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(this.local, null, 2), "utf8");
	}

	refreshBoards(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
			if (leaf.view instanceof BoardView) leaf.view.refresh();
		}
	}
}
