import { FileSystemAdapter, Plugin, WorkspaceLeaf } from "obsidian";
import { BoardView, VIEW_TYPE_BOARD } from "./board";
import { registerChipProcessor } from "./chips";
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

	private localSettingsPath(): string {
		const dir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
		return `${dir}/${LOCAL_SETTINGS_FILE}`;
	}

	async loadAllSettings(): Promise<void> {
		const data = ((await this.loadData()) ?? {}) as Partial<SharedSettings>;
		this.shared = {
			board: { ...DEFAULT_SHARED.board, ...data.board },
			milestones: { ...DEFAULT_SHARED.milestones, ...data.milestones },
			chips: { ...DEFAULT_SHARED.chips, ...data.chips },
		};

		const path = this.localSettingsPath();
		this.local = { ...DEFAULT_LOCAL };
		if (await this.app.vault.adapter.exists(path)) {
			try {
				const parsed = JSON.parse(
					await this.app.vault.adapter.read(path)
				) as Partial<LocalSettings>;
				this.local = { ...DEFAULT_LOCAL, ...parsed };
			} catch (e) {
				console.error("Dispatch: could not parse local.json — using defaults", e);
			}
		}
	}

	async saveShared(): Promise<void> {
		await this.saveData(this.shared);
		this.refreshBoards();
	}

	async saveLocal(): Promise<void> {
		await this.app.vault.adapter.write(
			this.localSettingsPath(),
			JSON.stringify(this.local, null, 2)
		);
	}

	refreshBoards(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
			if (leaf.view instanceof BoardView) leaf.view.refresh();
		}
	}
}
