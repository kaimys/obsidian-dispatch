import { ItemView, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { runHook, shellVars, substitute } from "./exec";
import type DispatchPlugin from "./main";
import type { ColumnConfig } from "./settings";

export const VIEW_TYPE_BOARD = "dispatch-board";

interface Card {
	file: TFile;
	status: string;
	title: string;
	badges: string[];
}

export class BoardView extends ItemView {
	private plugin: DispatchPlugin;
	private requestRender = debounce(() => this.render(), 250, true);

	constructor(leaf: WorkspaceLeaf, plugin: DispatchPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_BOARD;
	}

	getDisplayText(): string {
		return "Dispatch board";
	}

	getIcon(): string {
		return "kanban";
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
		this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
		this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
		this.registerEvent(this.app.vault.on("rename", () => this.requestRender()));
		this.render();
	}

	/** Re-render on demand (e.g. after settings changed). */
	refresh(): void {
		this.requestRender();
	}

	private collectCards(): Card[] {
		const { sourceFolders, statusProperty, titleProperty, badgeProperties } =
			this.plugin.shared.board;
		const folders = sourceFolders
			.map((f) => f.replace(/^\/+|\/+$/g, ""))
			.filter((f) => f.length > 0);
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => folders.some((folder) => file.path.startsWith(folder + "/")));

		return files.map((file) => {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const rawStatus = fm[statusProperty];
			const status = typeof rawStatus === "string" ? rawStatus.trim() : "";
			const id = fm[titleProperty];
			const title = id !== undefined && id !== null && id !== ""
				? `${String(id)} · ${file.basename}`
				: file.basename;
			const badges = badgeProperties
				.map((p) => fm[p])
				.filter((v) => v !== undefined && v !== null && v !== "")
				.map(String);
			return { file, status, title, badges };
		});
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("dispatch-board-container");

		if (this.plugin.shared.board.sourceFolders.length === 0) {
			root.createDiv({
				cls: "dispatch-board-empty",
				text: "Configure source folders in Settings → Dispatch to populate the board.",
			});
			return;
		}

		const cards = this.collectCards();
		const configured = this.plugin.shared.board.columns;
		const known = new Set(configured.map((c) => c.value));
		const extras: ColumnConfig[] = [...new Set(cards.map((c) => c.status))]
			.filter((s) => !known.has(s))
			.sort()
			.map((value) => ({ value }));

		const board = root.createDiv({ cls: "dispatch-board" });
		for (const col of [...configured, ...extras]) {
			const label = col.label ?? (col.value === "" ? "(no status)" : col.value);
			const colCards = cards.filter((c) => c.status === col.value);

			const colEl = board.createDiv({ cls: "dispatch-column" });
			const header = colEl.createDiv({ cls: "dispatch-column-header" });
			header.createSpan({ text: label });
			header.createSpan({ cls: "dispatch-column-count", text: String(colCards.length) });

			const list = colEl.createDiv({ cls: "dispatch-cards" });
			this.makeDropTarget(colEl, col.value);
			for (const card of colCards) this.renderCard(list, card);
		}
	}

	private renderCard(parent: HTMLElement, card: Card): void {
		const el = parent.createDiv({ cls: "dispatch-card", attr: { draggable: "true" } });
		el.createDiv({ cls: "dispatch-card-title", text: card.title });
		if (card.badges.length > 0) {
			const badges = el.createDiv({ cls: "dispatch-card-badges" });
			for (const badge of card.badges) {
				badges.createSpan({ cls: "dispatch-badge", text: badge });
			}
		}
		el.addEventListener("dragstart", (e) => {
			if (e.dataTransfer) {
				e.dataTransfer.setData("text/plain", card.file.path);
				e.dataTransfer.effectAllowed = "move";
			}
		});
		el.addEventListener("click", () => {
			void this.app.workspace.getLeaf("tab").openFile(card.file);
		});
	}

	private makeDropTarget(colEl: HTMLElement, status: string): void {
		colEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			colEl.addClass("dispatch-drop-active");
		});
		colEl.addEventListener("dragleave", () => colEl.removeClass("dispatch-drop-active"));
		colEl.addEventListener("drop", (e) => {
			e.preventDefault();
			colEl.removeClass("dispatch-drop-active");
			const path = e.dataTransfer?.getData("text/plain");
			if (path) void this.moveCard(path, status);
		});
	}

	private async moveCard(path: string, newStatus: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const prop = this.plugin.shared.board.statusProperty;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const oldStatus = typeof fm[prop] === "string" ? (fm[prop] as string) : "";
		if (oldStatus === newStatus) return;

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter[prop] = newStatus;
		});
		new Notice(`${file.basename}: ${oldStatus || "(none)"} → ${newStatus || "(none)"}`);
		this.runPostDropHook(file.path, oldStatus, newStatus);
	}

	private runPostDropHook(filePath: string, from: string, to: string): void {
		const hook = this.plugin.shared.board.postDropHook;
		if (!hook.command.trim()) return;
		if (!this.plugin.local.enableHooks) return;

		const cwd = this.plugin.local.repos[hook.repo];
		if (!cwd) {
			new Notice(
				`Dispatch: hook skipped — repository alias "${hook.repo}" is not configured on this device.`
			);
			return;
		}

		const command = substitute(hook.command, shellVars({ cwd, file: filePath, from, to }));
		runHook(command, cwd, (err, output) => {
			if (err) new Notice(`Dispatch hook failed: ${output || err.message}`, 8000);
			else new Notice(`Dispatch hook: ${output || "done"}`);
		});
	}
}
