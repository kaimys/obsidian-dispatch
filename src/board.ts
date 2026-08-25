import { App, ItemView, Menu, Modal, Notice, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { launchChip, launchColumnChip, launchEventChip } from "./chips";
import { runHook, shellVars, substitute } from "./exec";
import { renderSetupPanel } from "./setup";
import type DispatchPlugin from "./main";
import {
	buildCard,
	cardProblems,
	inFolders,
	indexReleases,
	milestonePercent,
	normalizeFolders,
	releaseNoteFrom,
	sortByRank,
	velocityPerDay,
} from "./cards";
import type { CardData, CardSettings, ReleaseNote } from "./cards";
import type { FrontmatterPatch } from "./moves";
import { frontmatterIn, frontmatterOf, updateFrontmatter } from "./vault";
import {
	planStatusDrop,
	planVersionDrop,
} from "./moves";
import {
	comparePatchKeys,
	compareRanks,
	displayValue,
	parseOpenActionOwners,
	parseTodoItems,
	patchKey,
	sliceKey,
	versionKey,
} from "./parse";
import type { ColumnConfig } from "./settings";

export const VIEW_TYPE_BOARD = "dispatch-board";

/**
 * Sentinel key for the built-in archive column of the milestone board.
 * Milestone columns are keyed by normalized major.minor, so a NUL prefix can
 * never collide with a real versionKey -- not even a version named "archive".
 *
 * Written as the escape \u0000, never as a literal NUL byte: a raw 0x00 in the
 * source makes git classify this file as binary (no diffs, no three-way merge)
 * and makes grep skip it without -a. The runtime string is identical.
 */
const ARCHIVE_KEY = "\u0000archive";

type BoardMode = "status" | "milestone" | "meetings" | "todos";

interface TodoItem {
	file: TFile;
	/** 0-based line index of the checkbox in the source note. */
	line: number;
	text: string;
	owner: string;
	/** Short source label (ticket id or note basename). */
	source: string;
}

interface MeetingCard {
	file: TFile;
	date: string;
	participants: string[];
	open?: number;
	owners: string[];
	/** Frontmatter problem to surface on the row (missing/invalid). */
	warning?: string;
}

type Card = CardData<TFile>;

interface MilestoneColumn {
	/** Normalized major.minor key ("" = no version). */
	key: string;
	display: string;
	/** Exact value a drop writes into the version property ("" = remove it). */
	writeValue: string;
	/** Position in plannedVersions (discovered columns get a large index). */
	order: number;
	/** True for a patch column of an expanded line (1.4.0, 1.4.1, …). */
	isPatch?: boolean;
	/** For a patch column: the major.minor line it belongs to. */
	line?: string;
}

type ReleaseInfo = ReleaseNote<TFile>;

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

export class BoardView extends ItemView {
	private plugin: DispatchPlugin;
	private mode: BoardMode = "status";
	private sliceProp = "";
	private sliceValue: string | null = null;
	/** Todos tab: active person filter (null = everyone). */
	private todoOwner: string | null = null;
	/** Release Plan: version lines expanded into their patch columns. */
	private expandedLines = new Set<string>();
	private focusedPath: string | null = null;
	/** Bumped per render; async renders bail when superseded. */
	private renderGen = 0;
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
		// The outlined play triangle of the Dispatch mark (▷, U+25B7), not a
		// board glyph: the product is what a card dispatches, and the board is
		// only where it is dispatched from. Keep in step with the ribbon icon
		// in main.ts — the tab and the ribbon are the same thing to a user.
		return "play";
	}

	// Returns a promise because ItemView declares one; nothing here awaits.
	onOpen(): Promise<void> {
		this.registerEvent(this.app.metadataCache.on("changed", () => this.requestRender()));
		this.registerEvent(this.app.vault.on("create", () => this.requestRender()));
		this.registerEvent(this.app.vault.on("delete", () => this.requestRender()));
		this.registerEvent(this.app.vault.on("rename", () => this.requestRender()));
		this.contentEl.setAttr("tabindex", "0");
		this.registerDomEvent(this.contentEl, "keydown", (e) => this.onKey(e));
		this.render();
		return Promise.resolve();
	}

	/** Re-render on demand (e.g. after settings changed). */
	refresh(): void {
		this.requestRender();
	}

	// ------------------------------------------------------------------ data

	private cardSettings(): CardSettings {
		const b = this.plugin.shared.board;
		const m = this.plugin.shared.milestones;
		return {
			statusProperty: b.statusProperty,
			titleProperty: b.titleProperty,
			assigneeProperty: b.assigneeProperty,
			badgeProperties: b.badgeProperties,
			questionsProperty: b.questionsProperty,
			testsProperty: b.testsProperty,
			discussionProperty: b.discussionProperty,
			orderProperty: b.orderProperty,
			columns: b.columns,
			versionProperty: m.versionProperty,
			sizeProperty: m.sizeProperty,
			completedProperty: m.completedProperty,
		};
	}

	/** Notes in the configured source folders, with their frontmatter. */
	private sourceNotes(): { file: TFile; fm: Record<string, unknown> }[] {
		const folders = normalizeFolders(this.plugin.shared.board.sourceFolders);
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => inFolders(file.path, folders))
			.map((file) => ({ file, fm: frontmatterOf(this.app, file) }));
	}

	private collectCards(): Card[] {
		const settings = this.cardSettings();
		return this.sourceNotes().map(({ file, fm }) => buildCard(file, fm, settings));
	}

	/** Ranked cards first (ascending), unranked after them (by title). */
	private sortCards(cards: Card[]): Card[] {
		return sortByRank(cards);
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
		addTab("milestone", "Release Plan");
		if (this.plugin.shared.meetings.folder) addTab("meetings", "Meetings");
		if (this.plugin.shared.todos.folders.length > 0) addTab("todos", "Todos");

		const right = tabs.createDiv({ cls: "dispatch-tabs-right" });
		this.renderProblemsBadge(right);
		const reload = right.createEl("button", {
			cls: "dispatch-tab",
			attr: { title: "Reload settings and tickets" },
		});
		setIcon(reload, "refresh-cw");
		reload.addEventListener("click", () => void this.plugin.reloadAll());

		if (this.mode === "meetings") {
			void this.renderMeetingsBoard(root, ++this.renderGen);
			return;
		}
		if (this.mode === "todos") {
			void this.renderTodosBoard(root, ++this.renderGen);
			return;
		}

		if (this.plugin.shared.board.sourceFolders.length === 0) {
			renderSetupPanel(root, this.plugin);
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
		const { assigneeProperty, statusProperty, badgeProperties, columns } =
			this.plugin.shared.board;
		// Status is always offered — on the Release Plan it answers "which of
		// these tickets are still in Refinement / waiting for review?".
		const props = [
			...new Set([assigneeProperty, statusProperty, ...badgeProperties].filter((p) => p)),
		];
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
		// Statuses read in pipeline order (Refinement before Ready for Review);
		// everything else alphabetically.
		const isStatus = this.sliceProp === statusProperty;
		const colIdx = new Map(columns.map((c, i) => [c.value, i]));
		const entries = [...counts.entries()].sort((a, b) => {
			if (isStatus) {
				const ia = colIdx.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
				const ib = colIdx.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
				if (ia !== ib) return ia - ib;
			}
			return a[0].localeCompare(b[0]);
		});
		for (const [value, count] of entries) {
			// Show the column's display label for statuses (draft → "Draft"),
			// but keep filtering on the raw frontmatter value.
			const label = isStatus ? (columns.find((c) => c.value === value)?.label ?? value) : value;
			const chip = bar.createEl("button", {
				cls:
					"dispatch-slice-chip" +
					(this.sliceValue === value ? " dispatch-slice-active" : ""),
				text: `${label} (${count})`,
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

			// Batch chips: one agent session over every ticket in the column.
			const columnTemplates = this.plugin.shared.chips.columnTemplates;
			if (columnTemplates.length > 0) {
				header.addClass("dispatch-column-header-clickable");
				const openMenu = (e: MouseEvent) => {
					const ids = colCards
						.map((c) => {
							return displayValue(c.raw[this.plugin.shared.board.titleProperty]);
						})
						.filter((s) => s !== "");
					const menu = new Menu();
					for (const template of columnTemplates) {
						menu.addItem((item) =>
							item
								.setTitle(`${template.label} (${ids.length})`)
								.setIcon("zap")
								.onClick(() =>
									launchColumnChip(this.plugin, template, ids, col.value)
								)
						);
					}
					menu.showAtMouseEvent(e);
				};
				header.addEventListener("click", openMenu);
				header.addEventListener("contextmenu", (e) => {
					e.preventDefault();
					openMenu(e);
				});
			}

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
	private collectReleases(): { byLine: Map<string, ReleaseInfo>; byPatch: Map<string, ReleaseInfo> } {
		const folder = this.plugin.shared.milestones.releaseNotesFolder.replace(/^\/+|\/+$/g, "");
		if (!folder) return { byLine: new Map(), byPatch: new Map() };
		const notes: ReleaseInfo[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(folder + "/")) continue;
			const fm = frontmatterOf(this.app, file);
			const note = releaseNoteFrom(file, fm);
			if (note) notes.push(note);
		}
		return indexReleases(notes);
	}

	private renderMilestoneBoard(root: HTMLElement, cards: Card[], allCards: Card[]): void {
		const ms = this.plugin.shared.milestones;
		const velocity = this.velocityPerDay(allCards);
		const releases = this.collectReleases();

		// Built-in archive (leftmost): cards out of the roadmap — excluded
		// statuses (e.g. Rejected) plus completed cards without a version.
		// Keeps "(no version)" a pure pool of unscheduled open work.
		const isArchived = (c: Card) =>
			c.excludedFromProgress || ((c.progress ?? 0) >= 100 && !c.version);
		const archived = cards.filter(isArchived);
		const active = cards.filter((c) => !isArchived(c));

		const columns = new Map<string, MilestoneColumn>();
		ms.plannedVersions.forEach((v, i) => {
			const key = versionKey(v);
			if (key && !columns.has(key)) columns.set(key, { key, display: key, writeValue: v, order: i });
		});
		for (const card of active) {
			if (!card.version) continue;
			const key = versionKey(card.version);
			if (!columns.has(key))
				columns.set(key, { key, display: key, writeValue: key, order: Number.MAX_SAFE_INTEGER });
		}
		const lineOrder = [...columns.values()].sort(compareMilestoneColumns);

		// Patch keys belonging to a version line — from its cards, its planned
		// versions and its release notes (so shipped patches show even with no
		// open ticket left).
		const patchesForLine = (lineKey: string): string[] => {
			const set = new Set<string>();
			for (const c of active) {
				if (c.version && versionKey(c.version) === lineKey) set.add(patchKey(c.version));
			}
			for (const v of ms.plannedVersions) {
				if (versionKey(v) === lineKey) set.add(patchKey(v));
			}
			for (const key of releases.byPatch.keys()) {
				if (versionKey(key) === lineKey) set.add(key);
			}
			return [...set].sort(comparePatchKeys);
		};

		// Expand the lines the user opened into one column per patch version.
		const ordered: MilestoneColumn[] = [];
		for (const col of lineOrder) {
			const patches = /^\d+\.\d+$/.test(col.key) ? patchesForLine(col.key) : [];
			if (!this.expandedLines.has(col.key) || patches.length === 0) {
				ordered.push(col);
				continue;
			}
			for (const p of patches) {
				// Write the planned spelling when we have one (keeps the "v" prefix
				// convention), otherwise mirror the line's own spelling.
				const planned = ms.plannedVersions.find((v) => patchKey(v) === p);
				const writeValue =
					planned ?? (/^[vV]/.test(col.writeValue) ? `v${p}` : p);
				ordered.push({
					key: p,
					display: p,
					writeValue,
					order: col.order,
					isPatch: true,
					line: col.key,
				});
			}
		}

		if (archived.length > 0) {
			ordered.unshift({ key: ARCHIVE_KEY, display: "(archive)", writeValue: "", order: -1 });
		}
		ordered.push({ key: "", display: "(no version)", writeValue: "", order: Number.MAX_SAFE_INTEGER });

		const board = root.createDiv({ cls: "dispatch-board" });
		// Versions ship sequentially — forecasts accumulate the remaining
		// weight of every earlier version line (incl. leftovers in released
		// ones) instead of pretending each version starts today.
		let pipelineBefore = 0;
		for (const col of ordered) {
			const isArchive = col.key === ARCHIVE_KEY;
			const colCards = (
				isArchive
					? archived
					: active.filter((c) =>
							col.isPatch
								? patchKey(c.version) === col.key
								: versionKey(c.version) === col.key
						)
			).sort(
				(a, b) =>
					a.statusIdx - b.statusIdx ||
					compareRanks(a.rank, b.rank) ||
					a.title.localeCompare(b.title)
			);

			const colEl = board.createDiv({
				cls: "dispatch-column",
				attr: isArchive
					? {}
					: {
							"data-col-key": col.key,
							"data-col-write": col.writeValue,
							"data-col-display": col.display,
						},
			});
			const header = colEl.createDiv({
				cls: "dispatch-column-header dispatch-milestone-header",
			});
			const titleRow = header.createDiv({ cls: "dispatch-milestone-title-row" });
			// Expand a version line into its patch releases (1.4 → 1.4.0, 1.4.1 …)
			// and collapse it again from any of those patch columns.
			if (col.isPatch) {
				const btn = titleRow.createEl("button", {
					cls: "dispatch-expand-toggle",
					text: "−",
					attr: { title: `Collapse ${col.line} back into one column` },
				});
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					this.expandedLines.delete(col.line ?? "");
					this.render();
				});
			} else if (/^\d+\.\d+$/.test(col.key) && patchesForLine(col.key).length > 1) {
				const btn = titleRow.createEl("button", {
					cls: "dispatch-expand-toggle",
					text: "+",
					attr: { title: `Show the patch releases of ${col.key}` },
				});
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					this.expandedLines.add(col.key);
					this.render();
				});
			}
			titleRow.createSpan({ cls: "dispatch-milestone-version", text: col.display });
			if (!isArchive && !col.isPatch) this.renderVersionTag(titleRow, col);
			titleRow.createSpan({ cls: "dispatch-column-count", text: String(colCards.length) });

			if (!isArchive) {
				const pct = this.milestonePercent(colCards);
				const progressRow = header.createDiv({ cls: "dispatch-milestone-progress" });
				const bar = progressRow.createDiv({ cls: "dispatch-progress-bar" });
				bar.createDiv({ cls: "dispatch-progress-fill" }).style.width = `${pct ?? 0}%`;
				progressRow.createSpan({
					cls: "dispatch-progress-label",
					text: pct === null ? "—" : `${pct}%`,
				});
			}
			const isVersionLine = /^\d+\.\d+(\.\d+)?$/.test(col.key) && !isArchive;
			let colRemaining = 0;
			if (isVersionLine) {
				for (const card of colCards) {
					if (card.excludedFromProgress) continue;
					colRemaining += card.size * (1 - (card.progress ?? 0) / 100);
				}
			}

			const release = isArchive
				? undefined
				: col.isPatch
					? releases.byPatch.get(col.key)
					: releases.byLine.get(col.key);
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
			} else if (isVersionLine) {
				this.renderForecast(header, col, colRemaining, pipelineBefore, velocity);
			}
			pipelineBefore += colRemaining;

			const list = colEl.createDiv({ cls: "dispatch-cards" });
			if (!isArchive) this.makeVersionDropTarget(colEl, col);
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
		return velocityPerDay(allCards, { completedProperty, velocityWindowDays });
	}

	/**
	 * Velocity-based ETA for an unreleased version column. Cumulative: the
	 * pipeline weight of all earlier version lines is finished first.
	 */
	private renderForecast(
		header: HTMLElement,
		col: MilestoneColumn,
		colRemaining: number,
		pipelineBefore: number,
		velocity: { perDay: number; samples: number } | null
	): void {
		if (!velocity || colRemaining <= 0) return;

		const total = pipelineBefore + colRemaining;
		const days = total / velocity.perDay;
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
					`Remaining weight ${colRemaining.toFixed(1)} + ${pipelineBefore.toFixed(1)} queued in earlier versions, ` +
					`at ${(velocity.perDay * 7).toFixed(1)}/week (${velocity.samples} completions in the last ${windowDays} days). ` +
					`Optimistic ${fmt(days * 0.6)} · pessimistic ${fmt(days * 1.4)}.`,
			},
		});
	}

	/**
	 * Weighted completion of a milestone: Σ(size × status progress) / Σ(size),
	 * skipping excluded statuses. Null when nothing is measurable.
	 */
	private milestonePercent(cards: Card[]): number | null {
		return milestonePercent(cards);
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
		titleRow.createSpan({ cls: "dispatch-card-title-text", text: card.title });

		if (card.discussion) {
			const chat = titleRow.createSpan({
				cls: "dispatch-card-chat",
				attr: { title: "Open discussion thread" },
			});
			setIcon(chat, "message-circle");
			chat.addEventListener("click", (e) => {
				e.stopPropagation();
				window.open(card.discussion);
			});
		}

		// Run lifecycle badge (queued/launched/running/waiting always; done
		// fades after 24h). Click for manual cleanup of ghost runs.
		const run = this.plugin.runs.latestForFile(card.file.path);
		if (
			run &&
			run.state !== "cancelled" &&
			(run.state !== "done" || Date.now() - run.lastTs < 86_400_000)
		) {
			const badge = titleRow.createSpan({
				cls: `dispatch-run-badge dispatch-run-${run.state}`,
				text: run.state === "launched" ? "started" : run.state,
				attr: { title: `${run.label} — ${run.state} (${new Date(run.lastTs).toLocaleString()})` },
			});
			badge.addEventListener("click", (e) => {
				e.stopPropagation();
				const menu = new Menu();
				if (run.state !== "done") {
					menu.addItem((item) =>
						item
							.setTitle("Mark run as done")
							.setIcon("check")
							.onClick(() =>
								this.plugin.runs.append({
									id: run.id,
									state: "done",
									ts: new Date().toISOString(),
								})
							)
					);
				}
				menu.addItem((item) =>
					item
						.setTitle("Clear badge")
						.setIcon("x")
						.onClick(() =>
							this.plugin.runs.append({
								id: run.id,
								state: "cancelled",
								ts: new Date().toISOString(),
							})
						)
				);
				menu.showAtMouseEvent(e);
			});
		}

		if (
			showStatus ||
			card.questions !== undefined ||
			card.tests !== undefined ||
			card.badges.length > 0
		) {
			const badges = el.createDiv({ cls: "dispatch-card-badges" });
			if (showStatus) {
				badges.createSpan({ cls: "dispatch-badge dispatch-badge-status", text: card.statusLabel });
			}
			if (card.questions !== undefined) {
				badges.createSpan({
					cls:
						"dispatch-badge dispatch-badge-questions" +
						(card.questions === 0 ? " dispatch-badge-questions-zero" : ""),
					text: `? ${card.questions}`,
					attr: {
						title:
							card.questions === 0
								? "No open questions — refinement complete"
								: `${card.questions} open question(s) before Ready for Dev`,
					},
				});
			}
			if (card.assignee) {
				badges.createSpan({
					cls: "dispatch-badge dispatch-badge-assignee",
					text: `@${card.assignee}`,
					attr: { title: `Assignee: ${card.assignee}` },
				});
			}
			if (card.tests !== undefined) {
				badges.createSpan({
					cls:
						"dispatch-badge dispatch-badge-tests" +
						(card.tests === 0 ? " dispatch-badge-tests-zero" : ""),
					text: `✓ ${card.tests}`,
					attr: {
						title:
							card.tests === 0
								? "Manual test plan complete"
								: `${card.tests} open manual test(s) — see the ticket's Test plan`,
					},
				});
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
			this.plugin.shared.board.assigneeProperty,
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

	// --------------------------------------------------------- meetings tab

	private async renderMeetingsBoard(root: HTMLElement, gen: number): Promise<void> {
		const settings = this.plugin.shared.meetings;
		const folder = settings.folder.replace(/^\/+|\/+$/g, "");
		const files = this.app.vault.getMarkdownFiles().filter((file) => {
			if (!file.path.startsWith(folder + "/")) return false;
			return !file.path.slice(folder.length + 1).includes("/"); // root only
		});

		const meetings: MeetingCard[] = [];
		for (const file of files) {
			const cachedFm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const fm = frontmatterIn(this.app.metadataCache.getFileCache(file));
			const rawDate = fm[settings.dateProperty];
			let date =
				typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawDate.trim())
					? rawDate.trim().slice(0, 10)
					: "";
			// Meetings with no/broken frontmatter still belong on the board:
			// fall back to a filename date and flag the problem on the row.
			let warning: string | undefined;
			if (!date) {
				warning = !cachedFm
					? "no frontmatter"
					: rawDate === undefined || rawDate === null || rawDate === ""
						? `missing ${settings.dateProperty}`
						: `invalid ${settings.dateProperty}: ${displayValue(rawDate)}`;
				const fromName = file.basename.match(/^(\d{4}-\d{2}-\d{2})/);
				if (fromName) date = fromName[1];
			}
			const rawParticipants = fm[settings.participantsProperty];
			const participants = Array.isArray(rawParticipants)
				? rawParticipants.map(displayValue)
				: typeof rawParticipants === "string" && rawParticipants
					? [rawParticipants]
					: [];
			const rawOpen = fm[settings.actionsProperty];
			const openNum = typeof rawOpen === "number" ? rawOpen : Number(rawOpen);
			const open =
				rawOpen !== "" && rawOpen !== null && rawOpen !== undefined && Number.isFinite(openNum)
					? Math.max(0, Math.floor(openNum))
					: undefined;
			let owners: string[] = [];
			try {
				owners = parseOpenActionOwners(
					await this.app.vault.cachedRead(file),
					this.plugin.shared.todos.assignees,
					this.plugin.shared.todos.fallbackAssignee
				);
			} catch {
				/* unreadable — count nothing */
			}
			meetings.push({ file, date, participants, open, owners, warning });
		}
		if (gen !== this.renderGen) return; // superseded by a newer render

		// One shared list container so calendar cards and meeting rows get
		// identical width/height; a divider separates upcoming from past.
		const now = new Date();
		const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
			now.getDate()
		).padStart(2, "0")}`;
		meetings.sort((a, b) => (b.date || "0000").localeCompare(a.date || "0000"));

		const list = root.createDiv({ cls: "dispatch-meeting-list" });

		// Upcoming events from the calendar feed (device-local secret URL).
		// A meeting note linked by an upcoming card is represented there (with
		// the agenda-status link) — don't list that specific note again below.
		const linkedPaths = new Set<string>();
		if (this.plugin.local.calendarUrl.trim()) {
			const { events, error } = await this.plugin.getUpcomingEvents();
			if (gen !== this.renderGen) return;
			list.createDiv({ cls: "dispatch-upcoming-title", text: "Upcoming · Google Calendar" });
			if (error) {
				list.createDiv({
					cls: "dispatch-upcoming-error",
					text: `calendar unavailable — ${error}`,
				});
			} else if (events.length === 0) {
				list.createDiv({
					cls: "dispatch-upcoming-error",
					text: `no events in the next ${this.plugin.shared.meetings.calendarLookaheadDays} days`,
				});
			}
			for (const event of events.slice(0, 6)) {
				const note = this.findMeetingNoteForEvent(event, meetings);
				if (note) linkedPaths.add(note.file.path);
				this.renderUpcomingRow(list, event, note);
			}
			list.createEl("hr", { cls: "dispatch-meeting-divider" });
		}

		// Meeting notes, newest first (skip the specific notes linked above).
		for (const meeting of meetings) {
			if (linkedPaths.has(meeting.file.path)) continue;
			this.renderMeetingRow(list, meeting, meeting.date > todayKey);
		}
		if (meetings.length === 0) {
			list.createDiv({ cls: "dispatch-board-empty", text: "No meeting notes found." });
		}
		this.applyFocus();
	}

	/** Meeting note for a calendar event: same date, then best title match. */
	private findMeetingNoteForEvent(
		event: { start: Date; title: string },
		meetings: MeetingCard[]
	): MeetingCard | undefined {
		const d = event.start;
		const pad = (n: number) => String(n).padStart(2, "0");
		const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		const sameDate = meetings.filter((m) => m.date === dateKey);
		if (sameDate.length <= 1) return sameDate[0];
		// Disambiguate several same-date notes by the event title.
		const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
		const title = norm(event.title);
		if (title && title !== "busy") {
			const match = sameDate.find((m) => {
				const name = norm(m.file.basename.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, ""));
				return name && (name.includes(title) || title.includes(name));
			});
			if (match) return match;
		}
		return sameDate[0];
	}

	/** A calendar event rendered as a meeting-row card (same dimensions). */
	private renderUpcomingRow(
		parent: HTMLElement,
		event: { start: Date; title: string; allDay: boolean },
		note: MeetingCard | undefined
	): void {
		const d = event.start;
		const pad = (n: number) => String(n).padStart(2, "0");
		const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

		const el = parent.createDiv({ cls: "dispatch-card dispatch-meeting-row dispatch-meeting-future" });
		const main = el.createDiv({ cls: "dispatch-meeting-main" });
		const titleRow = main.createDiv({ cls: "dispatch-card-title" });
		titleRow.createSpan({ cls: "dispatch-card-title-text", text: event.title });
		const sub = main.createDiv({ cls: "dispatch-meeting-sub" });
		sub.createSpan({
			text:
				`${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ` +
				`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.` +
				(event.allDay ? "" : ` ${pad(d.getHours())}:${pad(d.getMinutes())}`),
		});

		const badges = el.createDiv({ cls: "dispatch-meeting-badges" });
		if (note) {
			badges.createSpan({ cls: "dispatch-badge dispatch-upcoming-agenda", text: "agenda ✓" });
			el.setAttr("title", note.file.basename);
			el.addEventListener("click", () => {
				void this.app.workspace.getLeaf("tab").openFile(note.file);
			});
		} else {
			badges.createSpan({
				cls: "dispatch-badge dispatch-upcoming-noagenda",
				text: "no agenda yet",
			});
			el.addClass("dispatch-noclick");
		}

		// Calendar-event chips (e.g. "Prepare agenda", "Write report") — right-click.
		const chips = this.plugin.shared.meetings.calendarChips;
		if (chips.length > 0) {
			el.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				const menu = new Menu();
				for (const chip of chips) {
					menu.addItem((item) =>
						item
							.setTitle(chip.label)
							.setIcon("zap")
							.onClick(() => launchEventChip(this.plugin, chip, dateKey, event.title))
					);
				}
				menu.showAtMouseEvent(e);
			});
		}
	}

	private renderMeetingRow(parent: HTMLElement, meeting: MeetingCard, future: boolean): void {
		const el = parent.createDiv({
			cls: "dispatch-card dispatch-meeting-row" + (future ? " dispatch-meeting-future" : ""),
			attr: { "data-path": meeting.file.path },
		});

		const main = el.createDiv({ cls: "dispatch-meeting-main" });
		const titleRow = main.createDiv({ cls: "dispatch-card-title" });
		titleRow.createSpan({ cls: "dispatch-card-title-text", text: meeting.file.basename });
		const sub = main.createDiv({ cls: "dispatch-meeting-sub" });
		if (meeting.date) sub.createSpan({ text: future ? `${meeting.date} · upcoming` : meeting.date });
		if (meeting.participants.length > 0) {
			sub.createSpan({
				text: meeting.participants.map((p) => p.split(" ")[0]).join(", "),
				attr: { title: meeting.participants.join(", ") },
			});
		}

		// This meeting's open items, broken down per person.
		const badges = el.createDiv({ cls: "dispatch-meeting-badges" });
		if (meeting.warning) {
			badges.createSpan({
				cls: "dispatch-badge dispatch-badge-warning",
				text: `⚠ ${meeting.warning}`,
				attr: { title: "Frontmatter incomplete — date taken from the filename where possible." },
			});
		}
		const fallback = this.plugin.shared.todos.fallbackAssignee;
		const counts = new Map<string, number>();
		for (const owner of meeting.owners) counts.set(owner, (counts.get(owner) ?? 0) + 1);
		// Named owners by count first; the fallback ("Team") last, muted.
		const ordered = [...counts.entries()].sort((a, b) => {
			if (a[0] === fallback) return 1;
			if (b[0] === fallback) return -1;
			return b[1] - a[1];
		});
		for (const [name, n] of ordered) {
			badges.createSpan({
				cls:
					"dispatch-badge " +
					(name === fallback ? "dispatch-agg-unassigned" : "dispatch-badge-questions"),
				text: `${name}: ${n}`,
			});
		}
		if (counts.size === 0) {
			// No checkbox items in the note — fall back to the frontmatter counter.
			if (meeting.open !== undefined && meeting.open > 0) {
				badges.createSpan({
					cls: "dispatch-badge dispatch-badge-questions",
					text: `☐ ${meeting.open}`,
					attr: {
						title: `${meeting.open} open item(s) per frontmatter — not in checkbox format, so no per-person breakdown`,
					},
				});
			} else {
				badges.createSpan({
					cls: "dispatch-badge dispatch-badge-questions-zero",
					text: "✓ no open items",
				});
			}
		}

		el.addEventListener("click", () => {
			this.focusedPath = meeting.file.path;
			void this.app.workspace.getLeaf("tab").openFile(meeting.file);
		});
		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const templates = this.plugin.shared.meetings.templates;
			if (templates.length === 0) return;
			const menu = new Menu();
			for (const template of templates) {
				menu.addItem((item) =>
					item
						.setTitle(template.label)
						.setIcon("zap")
						.onClick(() => launchChip(this.plugin, template, meeting.file.path))
				);
			}
			menu.showAtMouseEvent(e);
		});
	}

	// ------------------------------------------------------------- todos tab

	/** Parse results memoized per file mtime — a render re-parses only changed files. */
	private todoCache = new Map<
		string,
		{ mtime: number; items: { line: number; text: string; owner: string }[] }
	>();
	/** Config signature — the parse memo is dropped when the config changes. */
	private todoCacheSig = "";

	private async collectTodos(): Promise<TodoItem[]> {
		const { folders, sections, assignees, fallbackAssignee } = this.plugin.shared.todos;
		const { assigneeProperty, titleProperty } = this.plugin.shared.board;
		const sectionSet = new Set(sections.map((s) => s.trim().toLowerCase()).filter(Boolean));
		const clean = folders.map((f) => f.replace(/^\/+|\/+$/g, "")).filter(Boolean);

		// Owner resolution depends on config, not just mtime — invalidate on change.
		const sig = JSON.stringify({ sections: [...sectionSet], assignees, fallbackAssignee });
		if (sig !== this.todoCacheSig) {
			this.todoCache.clear();
			this.todoCacheSig = sig;
		}

		const out: TodoItem[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const inFolder = clean.some(
				(folder) =>
					file.path.startsWith(folder + "/") &&
					!file.path.slice(folder.length + 1).includes("/")
			);
			if (!inFolder) continue;

			// Cheap reject via the metadata cache: no unchecked task, no read.
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.listItems?.some((li) => li.task === " ")) {
				this.todoCache.delete(file.path);
				continue;
			}

			const fm = frontmatterIn(cache);
			const rawAssignee = assigneeProperty ? fm[assigneeProperty] : undefined;
			const fallback =
				typeof rawAssignee === "string" && rawAssignee.trim() !== ""
					? rawAssignee.trim()
					: null;

			let entry = this.todoCache.get(file.path);
			if (!entry || entry.mtime !== file.stat.mtime) {
				try {
					entry = {
						mtime: file.stat.mtime,
						items: parseTodoItems(
							await this.app.vault.cachedRead(file),
							sectionSet,
							assignees,
							fallbackAssignee,
							fallback
						),
					};
				} catch {
					entry = { mtime: file.stat.mtime, items: [] };
				}
				this.todoCache.set(file.path, entry);
			}

			const id = displayValue(fm[titleProperty]);
			const source = id !== "" ? id : file.basename;
			for (const item of entry.items) {
				out.push({ file, line: item.line, text: item.text, owner: item.owner, source });
			}
		}
		return out;
	}

	private async renderTodosBoard(root: HTMLElement, gen: number): Promise<void> {
		const todos = await this.collectTodos();
		if (gen !== this.renderGen) return;

		const fallback = this.plugin.shared.todos.fallbackAssignee;
		const personalAll = todos.filter((t) => t.owner !== fallback);
		const team = todos.filter((t) => t.owner === fallback);

		// Slice bar: one chip per person with open items.
		const counts = new Map<string, number>();
		for (const todo of personalAll) counts.set(todo.owner, (counts.get(todo.owner) ?? 0) + 1);
		if (this.todoOwner && !counts.has(this.todoOwner)) this.todoOwner = null; // filter went stale

		if (counts.size > 0) {
			const bar = root.createDiv({ cls: "dispatch-slice-bar" });
			const allChip = bar.createEl("button", {
				cls: "dispatch-slice-chip" + (this.todoOwner === null ? " dispatch-slice-active" : ""),
				text: `Everyone (${personalAll.length})`,
			});
			allChip.addEventListener("click", () => {
				this.todoOwner = null;
				this.render();
			});
			for (const [name, n] of [...counts.entries()].sort(
				(a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
			)) {
				const chip = bar.createEl("button", {
					cls:
						"dispatch-slice-chip" + (this.todoOwner === name ? " dispatch-slice-active" : ""),
					text: `${name} (${n})`,
				});
				chip.addEventListener("click", () => {
					this.todoOwner = this.todoOwner === name ? null : name;
					this.render();
				});
			}
		}

		const personal = this.todoOwner
			? personalAll.filter((t) => t.owner === this.todoOwner)
			: personalAll;

		// Two columns: people (sliceable) and the whole team.
		const board = root.createDiv({ cls: "dispatch-board" });
		const renderColumn = (label: string, items: TodoItem[], isTeam: boolean) => {
			const colEl = board.createDiv({ cls: "dispatch-column dispatch-todo-column" });
			const header = colEl.createDiv({ cls: "dispatch-column-header" });
			header.createSpan({ text: label, cls: isTeam ? "dispatch-todo-unassigned-label" : "" });
			header.createSpan({ cls: "dispatch-column-count", text: String(items.length) });
			const list = colEl.createDiv({ cls: "dispatch-cards" });
			for (const todo of items) this.renderTodoCard(list, todo, !isTeam);
			if (items.length === 0) {
				list.createDiv({ cls: "dispatch-todo-source", text: "nothing open" });
			}
		};
		renderColumn(this.todoOwner ?? "Assigned", personal, false);
		renderColumn(fallback, team, true);

		if (todos.length === 0) {
			board.createDiv({ cls: "dispatch-board-empty", text: "No open todo items found." });
		}
		this.applyFocus();
	}

	private renderTodoCard(parent: HTMLElement, todo: TodoItem, showOwner = false): void {
		const el = parent.createDiv({
			cls: "dispatch-card dispatch-todo-card",
			attr: { "data-path": `${todo.file.path}#${todo.line}` },
		});
		el.createSpan({ cls: "dispatch-todo-check", text: "☐" });
		const main = el.createDiv({ cls: "dispatch-todo-main" });
		main.createDiv({ cls: "dispatch-todo-text", text: todo.text });
		const meta = main.createDiv({ cls: "dispatch-todo-source" });
		// The column no longer names the person, so the card does.
		if (showOwner) meta.createSpan({ cls: "dispatch-todo-owner", text: todo.owner });
		meta.createSpan({ text: todo.source });
		el.setAttr("title", "Open the note at this item — tick it there");
		el.addEventListener("click", () => {
			this.focusedPath = `${todo.file.path}#${todo.line}`;
			void this.app.workspace
				.getLeaf("tab")
				.openFile(todo.file, { eState: { line: todo.line } });
		});
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
		const plan = planStatusDrop(this.collectCards(), path, newStatus, insertIndex, {
			statusProperty: board.statusProperty,
			orderProperty: board.orderProperty,
			automations: board.automations,
		});
		if (!plan) return;
		for (const patch of plan.patches) await this.applyPatch(patch);
		if (plan.statusChanged) {
			this.notifyStatusChange(plan.moved.file, plan.oldStatus, newStatus);
		}
	}

	/** Write one planned frontmatter change. */
	private async applyPatch(patch: FrontmatterPatch<TFile>): Promise<void> {
		await updateFrontmatter(this.app, patch.file, (fm) => {
			for (const key of patch.unset ?? []) delete fm[key];
			Object.assign(fm, patch.set);
		});
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
		const card = this.collectCards().find((c) => c.file.path === path);
		if (!card) return;
		const patch = planVersionDrop(card, col, this.plugin.shared.milestones.versionProperty);
		// Same column — the raw value stays untouched (no format rewrite).
		if (!patch) return;
		await this.applyPatch(patch);
		new Notice(`${card.file.basename}: ${versionKey(card.version) || "(no version)"} → ${col.display}`);
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
		const { statusProperty, columns, requiredProperties } = this.plugin.shared.board;
		const problems: { file: TFile; message: string }[] = [];
		for (const { file, fm } of this.sourceNotes()) {
			for (const message of cardProblems(fm, { statusProperty, columns, requiredProperties })) {
				problems.push({ file, message });
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
		const current = frontmatterOf(this.app, this.file)[this.property];
		const input = this.contentEl.createEl("input", {
			cls: "dispatch-property-input",
			value: displayValue(current),
			attr: { placeholder: "Empty = remove property" },
		});
		input.focus();
		input.select();

		const save = async () => {
			const raw = input.value.trim();
			await updateFrontmatter(this.app, this.file, (frontmatter) => {
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
