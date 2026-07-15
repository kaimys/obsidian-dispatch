import { App, ItemView, Menu, Modal, Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { launchChip } from "./chips";
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
	/** Parsed completion date (ms) from the milestone completedProperty. */
	completedAt?: number;
	/** Raw frontmatter — used by the slice-by filter. */
	raw: Record<string, unknown>;
}

/** Slice key for a frontmatter value: empty/missing collapses to "(none)". */
function sliceKey(value: unknown): string {
	if (value === undefined || value === null || value === "") return "(none)";
	return String(value);
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

interface ReleaseInfo {
	file: TFile;
	date: string;
	version: string;
	/** True for the initial x.y.0 release of the line. */
	initial: boolean;
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
	private sliceProp = "";
	private sliceValue: string | null = null;
	private focusedPath: string | null = null;
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
		this.contentEl.setAttr("tabindex", "0");
		this.registerDomEvent(this.contentEl, "keydown", (e) => this.onKey(e));
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

			let completedAt: number | undefined;
			const { completedProperty } = this.plugin.shared.milestones;
			if (completedProperty) {
				const rawCompleted = fm[completedProperty];
				const parsed = typeof rawCompleted === "string" ? Date.parse(rawCompleted) : NaN;
				if (Number.isFinite(parsed)) completedAt = parsed;
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
				completedAt,
				raw: fm as Record<string, unknown>,
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
		this.renderProblemsBadge(tabs);

		if (this.plugin.shared.board.sourceFolders.length === 0) {
			root.createDiv({
				cls: "dispatch-board-empty",
				text: "Configure source folders in Settings → Dispatch to populate the board.",
			});
			return;
		}

		const allCards = this.collectCards();
		this.renderSliceBar(root, allCards);
		const cards =
			this.sliceProp && this.sliceValue !== null
				? allCards.filter((c) => sliceKey(c.raw[this.sliceProp]) === this.sliceValue)
				: allCards;

		if (this.mode === "status") this.renderStatusBoard(root, cards);
		else this.renderMilestoneBoard(root, cards, allCards);

		this.applyFocus();
	}

	// ------------------------------------------------------------- slice bar

	private renderSliceBar(root: HTMLElement, cards: Card[]): void {
		const props = this.plugin.shared.board.badgeProperties;
		if (props.length === 0) return;
		const bar = root.createDiv({ cls: "dispatch-slice-bar" });

		const select = bar.createEl("select", { cls: "dropdown" });
		select.createEl("option", { text: "Slice: off", value: "" });
		for (const prop of props) select.createEl("option", { text: `Slice: ${prop}`, value: prop });
		select.value = this.sliceProp;
		select.addEventListener("change", () => {
			this.sliceProp = select.value;
			this.sliceValue = null;
			this.render();
		});

		if (!this.sliceProp) return;
		const counts = new Map<string, number>();
		for (const card of cards) {
			const key = sliceKey(card.raw[this.sliceProp]);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		for (const [value, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			const chip = bar.createEl("button", {
				cls:
					"dispatch-slice-chip" +
					(this.sliceValue === value ? " dispatch-slice-active" : ""),
				text: `${value} (${count})`,
			});
			chip.addEventListener("click", () => {
				this.sliceValue = this.sliceValue === value ? null : value;
				this.render();
			});
		}
	}

	// ------------------------------------------------------------ status tab

	private renderStatusBoard(root: HTMLElement, cards: Card[]): void {
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

			const colEl = board.createDiv({
				cls: "dispatch-column",
				attr: { "data-col": col.value },
			});
			if (col.wip !== undefined && col.wip > 0) {
				if (colCards.length > col.wip) colEl.addClass("dispatch-wip-over");
				else if (colCards.length === col.wip) colEl.addClass("dispatch-wip-at");
			}
			const header = colEl.createDiv({ cls: "dispatch-column-header" });
			header.createSpan({ text: label });
			header.createSpan({
				cls: "dispatch-column-count",
				text:
					col.wip !== undefined && col.wip > 0
						? `${colCards.length}/${col.wip}`
						: String(colCards.length),
			});

			const list = colEl.createDiv({ cls: "dispatch-cards" });
			this.makeStatusDropTarget(colEl, list, col.value);
			for (const card of colCards) this.renderCard(list, card);
		}
	}

	// --------------------------------------------------------- milestone tab

	/**
	 * Release notes by major.minor key. The initial (x.y.0) note wins; without
	 * one, the earliest-dated note of the line is used.
	 */
	private collectReleases(): Map<string, ReleaseInfo> {
		const map = new Map<string, ReleaseInfo>();
		const folder = this.plugin.shared.milestones.releaseNotesFolder.replace(/^\/+|\/+$/g, "");
		if (!folder) return map;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(folder + "/")) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const version = typeof fm.version === "string" ? fm.version.trim() : "";
			if (!version) continue;
			const key = versionKey(version);
			const date = typeof fm.date === "string" ? fm.date.trim() : String(fm.date ?? "");
			const initial = /^[vV]?\d+\.\d+\.0$/.test(version);
			const existing = map.get(key);
			if (
				!existing ||
				(!existing.initial &&
					(initial || (date !== "" && existing.date !== "" && date < existing.date)))
			) {
				map.set(key, { file, date, version, initial });
			}
		}
		return map;
	}

	private renderMilestoneBoard(root: HTMLElement, cards: Card[], allCards: Card[]): void {
		const ms = this.plugin.shared.milestones;
		const velocity = this.velocityPerDay(allCards);
		const releases = this.collectReleases();

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

			const colEl = board.createDiv({
				cls: "dispatch-column",
				attr: {
					"data-col-key": col.key,
					"data-col-write": col.writeValue,
					"data-col-display": col.display,
				},
			});
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
			const release = releases.get(col.key);
			if (release) {
				// Released line: show the (linked) initial release date, no estimate.
				const link = header.createEl("a", {
					cls: "dispatch-release-link",
					text: release.date ? `released ${release.date}` : "release notes",
					attr: { title: release.file.basename },
				});
				link.addEventListener("click", (e) => {
					e.preventDefault();
					void this.app.workspace.getLeaf("tab").openFile(release.file);
				});
			} else {
				this.renderForecast(header, col, colCards, velocity);
			}

			const list = colEl.createDiv({ cls: "dispatch-cards" });
			this.makeVersionDropTarget(colEl, col);
			for (const card of colCards) this.renderCard(list, card, true);
		}
	}

	/**
	 * Completed weight per day over the look-back window, across the whole
	 * board (not just one column). Null when the feature is off or no
	 * completions fall inside the window.
	 */
	private velocityPerDay(allCards: Card[]): { perDay: number; samples: number } | null {
		const { completedProperty, velocityWindowDays } = this.plugin.shared.milestones;
		if (!completedProperty || velocityWindowDays <= 0) return null;
		const cutoff = Date.now() - velocityWindowDays * 86_400_000;
		let weight = 0;
		let samples = 0;
		for (const card of allCards) {
			if (card.completedAt === undefined || card.completedAt < cutoff) continue;
			weight += card.size;
			samples++;
		}
		if (samples === 0 || weight <= 0) return null;
		return { perDay: weight / velocityWindowDays, samples };
	}

	/** Velocity-based ETA line for a version column (semver columns only). */
	private renderForecast(
		header: HTMLElement,
		col: MilestoneColumn,
		colCards: Card[],
		velocity: { perDay: number; samples: number } | null
	): void {
		if (!velocity || !/^\d+\.\d+$/.test(col.key)) return;
		let remaining = 0;
		for (const card of colCards) {
			if (card.excludedFromProgress) continue;
			remaining += card.size * (1 - (card.progress ?? 0) / 100);
		}
		if (remaining <= 0) return;

		const days = remaining / velocity.perDay;
		const fmt = (d: number) => {
			const eta = new Date(Date.now() + d * 86_400_000);
			return `${eta.getFullYear()}-${String(eta.getMonth() + 1).padStart(2, "0")}-${String(
				eta.getDate()
			).padStart(2, "0")}`;
		};
		const windowDays = this.plugin.shared.milestones.velocityWindowDays;
		header.createDiv({
			cls: "dispatch-forecast",
			text: `≈ ${fmt(days)}`,
			attr: {
				title:
					`Remaining weight ${remaining.toFixed(1)} at ${(velocity.perDay * 7).toFixed(1)}/week ` +
					`(${velocity.samples} completions in the last ${windowDays} days). ` +
					`Optimistic ${fmt(days * 0.6)} · pessimistic ${fmt(days * 1.4)}.`,
			},
		});
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
		const el = parent.createDiv({
			cls: "dispatch-card",
			attr: { draggable: "true", "data-path": card.file.path },
		});
		const titleRow = el.createDiv({ cls: "dispatch-card-title" });
		titleRow.createSpan({ text: card.title });

		// Run lifecycle badge (launched/running always; done fades after 24h).
		const run = this.plugin.runs.latestForFile(card.file.path);
		if (run && (run.state !== "done" || Date.now() - run.lastTs < 86_400_000)) {
			titleRow.createSpan({
				cls: `dispatch-run-badge dispatch-run-${run.state}`,
				text: run.state === "launched" ? "started" : run.state,
				attr: { title: `${run.label} — ${run.state} (${new Date(run.lastTs).toLocaleString()})` },
			});
		}

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
			this.focusedPath = card.file.path;
			void this.app.workspace.getLeaf("tab").openFile(card.file);
		});
		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.focusedPath = card.file.path;
			this.showCardMenu(e, card);
		});
	}

	private showCardMenu(e: MouseEvent, card: Card): void {
		const menu = new Menu();
		const templates = this.plugin.shared.chips.templates;
		for (const template of templates) {
			menu.addItem((item) =>
				item
					.setTitle(template.label)
					.setIcon("zap")
					.onClick(() => launchChip(this.plugin, template, card.file.path))
			);
		}
		if (templates.length > 0) menu.addSeparator();

		const editable = [
			this.plugin.shared.milestones.sizeProperty,
			...this.plugin.shared.board.badgeProperties,
		].filter((p, i, arr) => p && arr.indexOf(p) === i);
		for (const prop of editable) {
			menu.addItem((item) =>
				item
					.setTitle(`Set ${prop}…`)
					.setIcon("pencil")
					.onClick(() => new PropertyEditModal(this.app, card.file, prop).open())
			);
		}
		menu.showAtMouseEvent(e);
	}

	// -------------------------------------------------------------- keyboard

	private applyFocus(): void {
		if (!this.focusedPath) return;
		const el = this.contentEl.querySelector<HTMLElement>(
			`.dispatch-card[data-path="${CSS.escape(this.focusedPath)}"]`
		);
		if (!el) return;
		el.addClass("dispatch-card-focused");
		el.scrollIntoView({ block: "nearest", inline: "nearest" });
	}

	private onKey(e: KeyboardEvent): void {
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement ||
			e.target instanceof HTMLSelectElement
		)
			return;
		const columns = Array.from(this.contentEl.querySelectorAll<HTMLElement>(".dispatch-column"));
		if (columns.length === 0) return;
		const cardsOf = (col: HTMLElement) =>
			Array.from(col.querySelectorAll<HTMLElement>(".dispatch-card"));

		let colIdx = -1;
		let cardIdx = -1;
		outer: for (let i = 0; i < columns.length; i++) {
			const cards = cardsOf(columns[i]);
			for (let j = 0; j < cards.length; j++) {
				if (cards[j].dataset.path === this.focusedPath) {
					colIdx = i;
					cardIdx = j;
					break outer;
				}
			}
		}

		const focusAt = (ci: number, ri: number) => {
			const cards = cardsOf(columns[ci]);
			if (cards.length === 0) return false;
			const el = cards[Math.max(0, Math.min(ri, cards.length - 1))];
			this.focusedPath = el.dataset.path ?? null;
			this.contentEl
				.querySelectorAll(".dispatch-card-focused")
				.forEach((c) => c.removeClass("dispatch-card-focused"));
			this.applyFocus();
			return true;
		};
		const nextColumnWithCards = (start: number, dir: number): number => {
			for (let i = start + dir; i >= 0 && i < columns.length; i += dir) {
				if (cardsOf(columns[i]).length > 0) return i;
			}
			return -1;
		};

		switch (e.key) {
			case "ArrowDown":
			case "ArrowUp": {
				if (colIdx === -1) {
					const first = nextColumnWithCards(-1, 1);
					if (first !== -1) focusAt(first, 0);
					break;
				}
				focusAt(colIdx, cardIdx + (e.key === "ArrowDown" ? 1 : -1));
				break;
			}
			case "ArrowLeft":
			case "ArrowRight": {
				const dir = e.key === "ArrowRight" ? 1 : -1;
				if (colIdx === -1) {
					const first = nextColumnWithCards(-1, 1);
					if (first !== -1) focusAt(first, 0);
					break;
				}
				const target = nextColumnWithCards(colIdx, dir);
				if (target !== -1) focusAt(target, cardIdx);
				break;
			}
			case "Enter":
			case "o": {
				if (!this.focusedPath) return;
				const file = this.app.vault.getAbstractFileByPath(this.focusedPath);
				if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
				break;
			}
			case "[":
			case "]": {
				if (colIdx === -1 || !this.focusedPath) return;
				const dir = e.key === "]" ? 1 : -1;
				const targetIdx = colIdx + dir;
				if (targetIdx < 0 || targetIdx >= columns.length) return;
				this.moveFocusedTo(columns[targetIdx]);
				break;
			}
			default:
				return;
		}
		e.preventDefault();
	}

	/** Move the focused card into the given column element (keyboard [ / ]). */
	private moveFocusedTo(colEl: HTMLElement): void {
		if (!this.focusedPath) return;
		if (this.mode === "status") {
			const status = colEl.dataset.col;
			if (status === undefined) return;
			void this.moveCard(this.focusedPath, status, Number.MAX_SAFE_INTEGER);
		} else {
			const { colKey, colWrite, colDisplay } = colEl.dataset;
			if (colKey === undefined) return;
			void this.moveCardToVersion(this.focusedPath, {
				key: colKey,
				writeValue: colWrite ?? "",
				display: colDisplay ?? colKey,
				order: 0,
			});
		}
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

		const ruleSets = statusChanged ? this.ruleSetsFor(oldStatus, newStatus) : {};

		// Ordering disabled — drops only change status.
		if (!board.orderProperty) {
			if (!statusChanged) return;
			await this.app.fileManager.processFrontMatter(moved.file, (fm) => {
				fm[board.statusProperty] = newStatus;
				Object.assign(fm, ruleSets);
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
				if (statusChanged) {
					fm[board.statusProperty] = newStatus;
					Object.assign(fm, ruleSets);
				}
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
					if (isMoved && statusChanged) {
						fm[board.statusProperty] = newStatus;
						Object.assign(fm, ruleSets);
					}
					fm[board.orderProperty] = rank;
				});
			}
		}

		if (statusChanged) this.notifyStatusChange(moved.file, oldStatus, newStatus);
	}

	/** Frontmatter assignments from all automation rules matching the target status. */
	private ruleSetsFor(from: string, to: string): Record<string, string> {
		const out: Record<string, string> = {};
		const now = new Date();
		const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
			now.getDate()
		).padStart(2, "0")}`;
		for (const rule of this.plugin.shared.board.automations) {
			if (rule.when.length > 0 && !rule.when.includes(to)) continue;
			for (const [key, value] of Object.entries(rule.set ?? {})) {
				out[key] = substitute(value, { date, datetime: now.toISOString(), from, to });
			}
		}
		return out;
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
		this.runAutomationCommands(file.path, oldStatus, newStatus);
	}

	private runAutomationCommands(filePath: string, from: string, to: string): void {
		const rules = this.plugin.shared.board.automations.filter(
			(r) => r.command.trim() && (r.when.length === 0 || r.when.includes(to))
		);
		if (rules.length === 0) return;
		if (!this.plugin.local.enableHooks) return;

		for (const rule of rules) {
			const cwd = this.plugin.local.repos[rule.repo];
			if (!cwd) {
				new Notice(
					`Dispatch: automation skipped — repository alias "${rule.repo}" is not configured on this device.`
				);
				continue;
			}
			const command = substitute(rule.command, shellVars({ cwd, file: filePath, from, to }));
			runHook(command, cwd, (err, output) => {
				if (err) new Notice(`Dispatch automation failed: ${output || err.message}`, 8000);
				else new Notice(`Dispatch: ${output || "automation done"}`);
			});
		}
	}

	// ------------------------------------------------------------- problems

	private collectProblems(): { file: TFile; message: string }[] {
		const { sourceFolders, statusProperty, columns, requiredProperties } =
			this.plugin.shared.board;
		const folders = sourceFolders
			.map((f) => f.replace(/^\/+|\/+$/g, ""))
			.filter((f) => f.length > 0);
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => folders.some((folder) => file.path.startsWith(folder + "/")));
		const known = new Set(columns.map((c) => c.value));

		const problems: { file: TFile; message: string }[] = [];
		for (const file of files) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			for (const prop of requiredProperties) {
				const value = fm[prop];
				if (value === undefined || value === null || value === "") {
					problems.push({ file, message: `missing required property "${prop}"` });
				} else if (typeof value === "string" && /\{.+\}/.test(value)) {
					problems.push({
						file,
						message: `unrendered template value in "${prop}": ${value}`,
					});
				}
			}
			const status = fm[statusProperty];
			if (typeof status === "string" && status.trim() !== "" && !known.has(status.trim())) {
				problems.push({ file, message: `status "${status}" is not a configured column` });
			}
		}
		return problems;
	}

	private renderProblemsBadge(tabs: HTMLElement): void {
		const problems = this.collectProblems();
		if (problems.length === 0) return;
		const badge = tabs.createEl("button", {
			cls: "dispatch-tab dispatch-problems",
			text: `⚠ ${problems.length}`,
			attr: { title: "Show board problems" },
		});
		badge.addEventListener("click", () => new ProblemsModal(this.app, problems).open());
	}
}

class ProblemsModal extends Modal {
	constructor(
		app: App,
		private problems: { file: TFile; message: string }[]
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(`Board problems (${this.problems.length})`);
		const list = this.contentEl.createEl("ul", { cls: "dispatch-problems-list" });
		for (const problem of this.problems) {
			const item = list.createEl("li");
			const link = item.createEl("a", { text: problem.file.basename });
			link.addEventListener("click", () => {
				this.close();
				void this.app.workspace.getLeaf("tab").openFile(problem.file);
			});
			item.createSpan({ text: ` — ${problem.message}` });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class PropertyEditModal extends Modal {
	constructor(
		app: App,
		private file: TFile,
		private property: string
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(`${this.file.basename} — ${this.property}`);
		const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter ?? {};
		const current = fm[this.property];
		const input = this.contentEl.createEl("input", {
			cls: "dispatch-property-input",
			value: current === undefined || current === null ? "" : String(current),
			attr: { placeholder: "empty = remove property" },
		});
		input.focus();
		input.select();

		const save = async () => {
			const raw = input.value.trim();
			await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
				if (raw === "") delete frontmatter[this.property];
				else if (!Number.isNaN(Number(raw))) frontmatter[this.property] = Number(raw);
				else frontmatter[this.property] = raw;
			});
			this.close();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") void save();
			else if (e.key === "Escape") this.close();
		});

		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const ok = row.createEl("button", { cls: "mod-cta", text: "Save" });
		ok.addEventListener("click", () => void save());
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
