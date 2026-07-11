import { ItemView, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { runHook, shellVars, substitute } from "./exec";
import type DispatchPlugin from "./main";
import type { ColumnConfig } from "./settings";

export const VIEW_TYPE_BOARD = "dispatch-board";

/** Spacing between freshly assigned ranks — leaves room for midpoint inserts. */
const RANK_GAP = 1024;

interface Card {
	file: TFile;
	status: string;
	title: string;
	badges: string[];
	rank?: number;
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
		const { sourceFolders, statusProperty, titleProperty, badgeProperties, orderProperty } =
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
			const title =
				id !== undefined && id !== null && id !== ""
					? `${String(id)} · ${file.basename}`
					: file.basename;
			const badges = badgeProperties
				.map((p) => fm[p])
				.filter((v) => v !== undefined && v !== null && v !== "")
				.map(String);

			let rank: number | undefined;
			if (orderProperty) {
				const raw = fm[orderProperty];
				if (typeof raw === "number" && Number.isFinite(raw)) rank = raw;
				else if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw)))
					rank = Number(raw);
			}
			return { file, status, title, badges, rank };
		});
	}

	/** Ranked cards first (ascending), unranked after them (by title). */
	private sortCards(cards: Card[]): Card[] {
		return [...cards].sort((a, b) => {
			if (a.rank !== undefined && b.rank !== undefined) {
				return a.rank - b.rank || a.title.localeCompare(b.title);
			}
			if (a.rank !== undefined) return -1;
			if (b.rank !== undefined) return 1;
			return a.title.localeCompare(b.title);
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
			const colCards = this.sortCards(cards.filter((c) => c.status === col.value));

			const colEl = board.createDiv({ cls: "dispatch-column" });
			const header = colEl.createDiv({ cls: "dispatch-column-header" });
			header.createSpan({ text: label });
			header.createSpan({ cls: "dispatch-column-count", text: String(colCards.length) });

			const list = colEl.createDiv({ cls: "dispatch-cards" });
			this.makeDropTarget(colEl, list, col.value);
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

	private clearInsertMarkers(list: HTMLElement): void {
		list.removeClass("dispatch-insert-end");
		for (const child of Array.from(list.children)) {
			(child as HTMLElement).removeClass("dispatch-insert-before");
		}
	}

	/** Visual insertion index in a column's card list for a given pointer Y. */
	private insertionIndex(list: HTMLElement, y: number): number {
		const children = Array.from(list.children) as HTMLElement[];
		for (let i = 0; i < children.length; i++) {
			const rect = children[i].getBoundingClientRect();
			if (y < rect.top + rect.height / 2) return i;
		}
		return children.length;
	}

	private makeDropTarget(colEl: HTMLElement, list: HTMLElement, status: string): void {
		colEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			colEl.addClass("dispatch-drop-active");
			if (!this.plugin.shared.board.orderProperty) return;
			this.clearInsertMarkers(list);
			const index = this.insertionIndex(list, e.clientY);
			const children = Array.from(list.children) as HTMLElement[];
			if (index < children.length) children[index].addClass("dispatch-insert-before");
			else list.addClass("dispatch-insert-end");
		});
		colEl.addEventListener("dragleave", (e) => {
			// dragleave also fires when moving between child elements — ignore those
			if (e.relatedTarget instanceof Node && colEl.contains(e.relatedTarget)) return;
			colEl.removeClass("dispatch-drop-active");
			this.clearInsertMarkers(list);
		});
		colEl.addEventListener("drop", (e) => {
			e.preventDefault();
			colEl.removeClass("dispatch-drop-active");
			this.clearInsertMarkers(list);
			const path = e.dataTransfer?.getData("text/plain");
			if (path) void this.moveCard(path, status, this.insertionIndex(list, e.clientY));
		});
	}

	private async moveCard(path: string, newStatus: string, insertIndex: number): Promise<void> {
		const board = this.plugin.shared.board;
		const cards = this.collectCards();
		const moved = cards.find((c) => c.file.path === path);
		if (!moved) return;

		const oldStatus = moved.status;
		const statusChanged = oldStatus !== newStatus;

		// Ordering disabled — drops only change status.
		if (!board.orderProperty) {
			if (!statusChanged) return;
			await this.app.fileManager.processFrontMatter(moved.file, (fm) => {
				fm[board.statusProperty] = newStatus;
			});
			this.notifyStatusChange(moved.file, oldStatus, newStatus);
			return;
		}

		const columnCards = this.sortCards(
			cards.filter((c) => c.status === newStatus && c.file.path !== path)
		);

		// The visual index counts the moved card itself on same-column drags.
		let idx = insertIndex;
		let origIdx = -1;
		if (!statusChanged) {
			const visual = this.sortCards(cards.filter((c) => c.status === newStatus));
			origIdx = visual.findIndex((c) => c.file.path === path);
			if (origIdx !== -1 && origIdx < idx) idx--;
		}
		idx = Math.max(0, Math.min(idx, columnCards.length));
		if (!statusChanged && idx === origIdx) return;

		const prev = idx > 0 ? columnCards[idx - 1] : undefined;
		const next = idx < columnCards.length ? columnCards[idx] : undefined;

		const strictlyRanked =
			columnCards.every((c) => c.rank !== undefined) &&
			columnCards.every(
				(c, i) => i === 0 || (columnCards[i - 1].rank as number) < (c.rank as number)
			);

		// Preferred path: touch only the moved note.
		let singleRank: number | undefined;
		if (strictlyRanked) {
			if (prev && next) {
				if ((next.rank as number) - (prev.rank as number) > 1) {
					singleRank = Math.floor(((prev.rank as number) + (next.rank as number)) / 2);
				}
			} else if (prev) singleRank = (prev.rank as number) + RANK_GAP;
			else if (next) singleRank = (next.rank as number) - RANK_GAP;
			else singleRank = RANK_GAP;
		}

		if (singleRank !== undefined) {
			await this.app.fileManager.processFrontMatter(moved.file, (fm) => {
				if (statusChanged) fm[board.statusProperty] = newStatus;
				fm[board.orderProperty] = singleRank;
			});
		} else {
			// Column has unranked/duplicate ranks or the gap is exhausted:
			// renormalize, writing only notes whose rank actually changes.
			const desired = [...columnCards.slice(0, idx), moved, ...columnCards.slice(idx)];
			for (let i = 0; i < desired.length; i++) {
				const card = desired[i];
				const rank = (i + 1) * RANK_GAP;
				const isMoved = card.file.path === path;
				if (!isMoved && card.rank === rank) continue;
				await this.app.fileManager.processFrontMatter(card.file, (fm) => {
					if (isMoved && statusChanged) fm[board.statusProperty] = newStatus;
					fm[board.orderProperty] = rank;
				});
			}
		}

		if (statusChanged) this.notifyStatusChange(moved.file, oldStatus, newStatus);
	}

	private notifyStatusChange(file: TFile, oldStatus: string, newStatus: string): void {
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
