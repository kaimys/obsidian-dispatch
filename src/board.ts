import { ItemView, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { runHook, shellVars, substitute } from "./exec";
import type DispatchPlugin from "./main";
import type { ColumnConfig } from "./settings";

export const VIEW_TYPE_BOARD = "dispatch-board";

/** Spacing between freshly assigned ranks — leaves room for midpoint inserts. */
const RANK_GAP = 1024;

type BoardMode = "status" | "milestone";

interface Card {
	file: TFile;
	status: string;
	/** Display label of the card's status (column label if configured). */
	statusLabel: string;
	/** Position of the card's status in the configured column order (for milestone sorting). */
	statusIdx: number;
	title: string;
	badges: string[];
	rank?: number;
	version: string;
	size: number;
	/** Completion contribution (0–100) of the card's status, per column config. */
	progress?: number;
	excludedFromProgress: boolean;
}

interface MilestoneColumn {
	/** Normalized major.minor key ("" = no version). */
	key: string;
	display: string;
	/** Exact value a drop writes into the version property ("" = remove it). */
	writeValue: string;
	/** Position in plannedVersions (discovered columns get a large index). */
	order: number;
}

/** Normalize a version value to its major.minor key ("v1.2.0" → "1.2"). */
function versionKey(raw: string): string {
	const m = raw.trim().match(/^[vV]?(\d+)\.(\d+)/);
	return m ? `${m[1]}.${m[2]}` : raw.trim();
}

/**
 * Special (non-version) columns like "Rejected" or "Icebox" sort leftmost, in
 * their plannedVersions order; semver columns follow, ascending.
 */
function compareMilestoneColumns(a: MilestoneColumn, b: MilestoneColumn): number {
	const pa = a.key.match(/^(\d+)\.(\d+)$/);
	const pb = b.key.match(/^(\d+)\.(\d+)$/);
	if (!pa !== !pb) return pa ? 1 : -1;
	if (pa && pb) return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]);
	return a.order - b.order || a.key.localeCompare(b.key);
}

function compareRanks(a?: number, b?: number): number {
	if (a !== undefined && b !== undefined) return a - b;
	if (a !== undefined) return -1;
	if (b !== undefined) return 1;
	return 0;
}

export class BoardView extends ItemView {
	private plugin: DispatchPlugin;
	private mode: BoardMode = "status";
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

	// ------------------------------------------------------------------ data

	private collectCards(): Card[] {
		const { sourceFolders, statusProperty, titleProperty, badgeProperties, orderProperty, columns } =
			this.plugin.shared.board;
		const { versionProperty, sizeProperty } = this.plugin.shared.milestones;
		const statusMeta = new Map(
			columns.map((c, i) => [
				c.value,
				{ idx: i, label: c.label, progress: c.progress, excluded: c.excluded === true },
			])
		);
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

			const rawVersion = fm[versionProperty];
			const version =
				typeof rawVersion === "string"
					? rawVersion.trim()
					: typeof rawVersion === "number"
						? String(rawVersion)
						: "";

			let size = 1;
			if (sizeProperty) {
				const rawSize = fm[sizeProperty];
				const n = typeof rawSize === "number" ? rawSize : Number(rawSize);
				if (Number.isFinite(n) && n > 0) size = n;
			}

			const meta = statusMeta.get(status);
			return {
				file,
				status,
				statusLabel: meta?.label ?? (status || "(no status)"),
				statusIdx: meta?.idx ?? Number.MAX_SAFE_INTEGER,
				title,
				badges,
				rank,
				version,
				size,
				progress: meta?.progress,
				excludedFromProgress: meta?.excluded ?? false,
			};
		});
	}

	/** Ranked cards first (ascending), unranked after them (by title). */
	private sortCards(cards: Card[]): Card[] {
		return [...cards].sort(
			(a, b) => compareRanks(a.rank, b.rank) || a.title.localeCompare(b.title)
		);
	}

	// ---------------------------------------------------------------- render

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("dispatch-board-container");

		const tabs = root.createDiv({ cls: "dispatch-tabs" });
		const addTab = (mode: BoardMode, label: string) => {
			const tab = tabs.createEl("button", { cls: "dispatch-tab", text: label });
			if (this.mode === mode) tab.addClass("dispatch-tab-active");
			tab.addEventListener("click", () => {
				this.mode = mode;
				this.render();
			});
		};
		addTab("status", "Kanban");
		addTab("milestone", "Milestones");

		if (this.plugin.shared.board.sourceFolders.length === 0) {
			root.createDiv({
				cls: "dispatch-board-empty",
				text: "Configure source folders in Settings → Dispatch to populate the board.",
			});
			return;
		}

		if (this.mode === "status") this.renderStatusBoard(root);
		else this.renderMilestoneBoard(root);
	}

	// ------------------------------------------------------------ status tab

	private renderStatusBoard(root: HTMLElement): void {
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
			this.makeStatusDropTarget(colEl, list, col.value);
			for (const card of colCards) this.renderCard(list, card);
		}
	}

	// --------------------------------------------------------- milestone tab

	private renderMilestoneBoard(root: HTMLElement): void {
		const ms = this.plugin.shared.milestones;
		const cards = this.collectCards();

		const columns = new Map<string, MilestoneColumn>();
		ms.plannedVersions.forEach((v, i) => {
			const key = versionKey(v);
			if (key && !columns.has(key)) columns.set(key, { key, display: key, writeValue: v, order: i });
		});
		for (const card of cards) {
			if (!card.version) continue;
			const key = versionKey(card.version);
			if (!columns.has(key))
				columns.set(key, { key, display: key, writeValue: key, order: Number.MAX_SAFE_INTEGER });
		}
		const ordered = [...columns.values()].sort(compareMilestoneColumns);
		ordered.push({ key: "", display: "(no version)", writeValue: "", order: Number.MAX_SAFE_INTEGER });

		const board = root.createDiv({ cls: "dispatch-board" });
		for (const col of ordered) {
			const colCards = cards
				.filter((c) => versionKey(c.version) === col.key)
				.sort(
					(a, b) =>
						a.statusIdx - b.statusIdx ||
						compareRanks(a.rank, b.rank) ||
						a.title.localeCompare(b.title)
				);

			const colEl = board.createDiv({ cls: "dispatch-column" });
			const header = colEl.createDiv({
				cls: "dispatch-column-header dispatch-milestone-header",
			});
			const titleRow = header.createDiv({ cls: "dispatch-milestone-title-row" });
			titleRow.createSpan({ cls: "dispatch-milestone-version", text: col.display });
			this.renderVersionTag(titleRow, col);
			titleRow.createSpan({ cls: "dispatch-column-count", text: String(colCards.length) });

			const pct = this.milestonePercent(colCards);
			const progressRow = header.createDiv({ cls: "dispatch-milestone-progress" });
			const bar = progressRow.createDiv({ cls: "dispatch-progress-bar" });
			bar.createDiv({ cls: "dispatch-progress-fill" }).style.width = `${pct ?? 0}%`;
			progressRow.createSpan({
				cls: "dispatch-progress-label",
				text: pct === null ? "—" : `${pct}%`,
			});

			const list = colEl.createDiv({ cls: "dispatch-cards" });
			this.makeVersionDropTarget(colEl, col);
			for (const card of colCards) this.renderCard(list, card, true);
		}
	}

	/**
	 * Weighted completion of a milestone: Σ(size × status progress) / Σ(size),
	 * skipping excluded statuses. Null when nothing is measurable.
	 */
	private milestonePercent(cards: Card[]): number | null {
		let weight = 0;
		let done = 0;
		for (const c of cards) {
			if (c.excludedFromProgress) continue;
			weight += c.size;
			done += (c.size * (c.progress ?? 0)) / 100;
		}
		if (weight === 0) return null;
		return Math.round((100 * done) / weight);
	}

	private renderVersionTag(parent: HTMLElement, col: MilestoneColumn): void {
		if (col.key === "") return;
		const ms = this.plugin.shared.milestones;
		const current = ms.tags[col.key] ?? "";
		const tag = parent.createEl("button", {
			cls: "dispatch-version-tag" + (current ? "" : " dispatch-version-tag-empty"),
			text: current || "+ tag",
			attr: { title: "Click to edit the version tag" },
		});
		tag.addEventListener("click", () => {
			const input = createEl("input", {
				cls: "dispatch-version-tag-input",
				value: current,
				attr: { placeholder: "MVP, Closed Beta, …" },
			});
			tag.replaceWith(input);
			input.focus();
			input.select();
			let settled = false;
			const save = async () => {
				if (settled) return;
				settled = true;
				const value = input.value.trim();
				if (value) ms.tags[col.key] = value;
				else delete ms.tags[col.key];
				await this.plugin.saveShared(); // re-renders all boards
			};
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") void save();
				else if (e.key === "Escape") {
					settled = true;
					this.render();
				}
			});
			input.addEventListener("blur", () => void save());
		});
	}

	// ---------------------------------------------------------------- cards

	private renderCard(parent: HTMLElement, card: Card, showStatus = false): void {
		const el = parent.createDiv({ cls: "dispatch-card", attr: { draggable: "true" } });
		el.createDiv({ cls: "dispatch-card-title", text: card.title });
		if (showStatus || card.badges.length > 0) {
			const badges = el.createDiv({ cls: "dispatch-card-badges" });
			if (showStatus) {
				badges.createSpan({ cls: "dispatch-badge dispatch-badge-status", text: card.statusLabel });
			}
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

	// ------------------------------------------------------ status drag&drop

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

	private makeStatusDropTarget(colEl: HTMLElement, list: HTMLElement, status: string): void {
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

	// ----------------------------------------------------- version drag&drop

	private makeVersionDropTarget(colEl: HTMLElement, col: MilestoneColumn): void {
		colEl.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			colEl.addClass("dispatch-drop-active");
		});
		colEl.addEventListener("dragleave", (e) => {
			if (e.relatedTarget instanceof Node && colEl.contains(e.relatedTarget)) return;
			colEl.removeClass("dispatch-drop-active");
		});
		colEl.addEventListener("drop", (e) => {
			e.preventDefault();
			colEl.removeClass("dispatch-drop-active");
			const path = e.dataTransfer?.getData("text/plain");
			if (path) void this.moveCardToVersion(path, col);
		});
	}

	private async moveCardToVersion(path: string, col: MilestoneColumn): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const prop = this.plugin.shared.milestones.versionProperty;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const current = typeof fm[prop] === "string" ? (fm[prop] as string).trim() : "";
		// Same column — keep the raw value untouched (no format rewrite).
		if (versionKey(current) === col.key) return;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			if (col.writeValue === "") delete frontmatter[prop];
			else frontmatter[prop] = col.writeValue;
		});
		new Notice(
			`${file.basename}: ${versionKey(current) || "(no version)"} → ${col.display}`
		);
	}

	// ------------------------------------------------------------------ misc

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
