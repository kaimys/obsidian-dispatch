/**
 * Release Plan column construction — pure, so the value a drop writes can be
 * asserted without a view (ADR-0016). Inputs are plain version strings.
 *
 * A numeric version line writes its highest known patch in canonical
 * "vMAJOR.MINOR.PATCH" form (ADR-0036); non-version labels ("Icebox") keep the
 * spelling they were planned or discovered with.
 */
import type { CardData } from "./cards";
import { comparePatchKeys, compareRanks, patchKey, versionKey } from "./parse";

export interface MilestoneColumn {
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

const LINE_KEY = /^\d+\.\d+$/;

/** True for a numeric major.minor line key ("1.4"), false for "Icebox". */
export function isVersionLine(key: string): boolean {
	return LINE_KEY.test(key);
}

/**
 * Special (non-version) columns like "Rejected" or "Icebox" sort leftmost, in
 * their plannedVersions order; semver columns follow, ascending.
 */
export function compareMilestoneColumns(a: MilestoneColumn, b: MilestoneColumn): number {
	const pa = a.key.match(/^(\d+)\.(\d+)$/);
	const pb = b.key.match(/^(\d+)\.(\d+)$/);
	if (!pa !== !pb) return pa ? 1 : -1;
	if (pa && pb) return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]);
	return a.order - b.order || a.key.localeCompare(b.key);
}

/** Canonical spelling of a line or patch key: "1.4" → "v1.4.0", "1.4.2" → "v1.4.2". */
export function canonicalVersion(key: string): string {
	return /^\d+\.\d+\.\d+$/.test(key) ? `v${key}` : `v${key}.0`;
}

/**
 * The value a drop on a collapsed line writes: the highest patch among the
 * candidates in that line, compared numerically, a missing patch counting as
 * .0. Source, order and frequency of the candidates never matter.
 */
export function lineWriteValue(lineKey: string, candidates: readonly string[]): string {
	let highest = 0;
	for (const v of candidates) {
		if (!v || versionKey(v) !== lineKey) continue;
		const patch = Number(patchKey(v).split(".")[2] ?? 0);
		if (patch > highest) highest = patch;
	}
	return `v${lineKey}.${highest}`;
}

/**
 * Whether a card belongs to a column: a patch column holds its exact patch,
 * every other column its normalized line or label. The board fills columns
 * with this and a drop uses it to decide "already there", so the two agree.
 */
export function inColumn(
	card: Pick<CardData, "version">,
	col: Pick<MilestoneColumn, "key" | "isPatch">
): boolean {
	return col.isPatch ? patchKey(card.version) === col.key : versionKey(card.version) === col.key;
}

type OrderFields = Pick<CardData, "releaseRank" | "statusIdx" | "rank" | "title">;

/**
 * Release Plan order within a column: the manual release order first
 * (ascending), then — for cards without one — by pipeline stage, Kanban rank
 * and title. With the release order off no card has a release rank, so this
 * is exactly the status-first sort the board used before it existed.
 */
export function compareReleaseOrder(a: OrderFields, b: OrderFields): number {
	return (
		compareRanks(a.releaseRank, b.releaseRank) ||
		a.statusIdx - b.statusIdx ||
		compareRanks(a.rank, b.rank) ||
		a.title.localeCompare(b.title)
	);
}

type ArchiveFields = Pick<CardData, "excludedFromProgress" | "progress" | "version">;

/**
 * Cards out of the roadmap, shown in the (archive) column: excluded statuses
 * (e.g. Rejected) plus completed cards without a version — which keeps
 * "(no version)" a pure pool of unscheduled open work.
 */
export function isArchivedCard(card: ArchiveFields): boolean {
	return card.excludedFromProgress || ((card.progress ?? 0) >= 100 && !card.version);
}

/**
 * What decides a numeric line's write value: the planned entries plus the
 * version of every non-archived card. Pass every card, not a slice, so a
 * slice hiding the highest patch never downgrades a write.
 */
export function lineCandidates(planned: readonly string[], cards: readonly ArchiveFields[]): string[] {
	return [...planned, ...cards.filter((c) => !isArchivedCard(c)).map((c) => c.version)];
}

/**
 * One column per version line, sorted. Planned entries create columns (empty
 * ones included); `shown` are the versions of the cards on screen, which add
 * discovered columns. `candidates` — planned entries plus every non-archived
 * card, sliced or not — decide what a numeric line writes, so a slice hiding
 * the highest patch never downgrades a drop.
 */
export function buildLineColumns(
	planned: readonly string[],
	shown: readonly string[],
	candidates: readonly string[]
): MilestoneColumn[] {
	const columns = new Map<string, MilestoneColumn>();
	const add = (raw: string, order: number) => {
		const key = versionKey(raw);
		if (!key || columns.has(key)) return;
		const writeValue = isVersionLine(key) ? lineWriteValue(key, candidates) : raw;
		columns.set(key, { key, display: key, writeValue, order });
	};
	planned.forEach((v, i) => add(v, i));
	// A discovered label writes its normalized key, as it always has.
	for (const v of shown) if (v) add(versionKey(v), Number.MAX_SAFE_INTEGER);
	return [...columns.values()].sort(compareMilestoneColumns);
}

/**
 * Patch keys belonging to a version line — from its cards, its planned
 * versions and its release notes (so shipped patches show even with no open
 * ticket left). A value without a patch keeps its bare line bucket ("1.4").
 */
export function linePatches(
	lineKey: string,
	versions: readonly string[],
	releasePatchKeys: Iterable<string>
): string[] {
	const set = new Set<string>();
	for (const v of versions) {
		if (v && versionKey(v) === lineKey) set.add(patchKey(v));
	}
	for (const key of releasePatchKeys) {
		if (versionKey(key) === lineKey) set.add(key);
	}
	return [...set].sort(comparePatchKeys);
}

/**
 * An expanded line's patch columns. Each writes its own patch in canonical
 * form — never the line's highest, never a planned spelling; the bare bucket
 * ("1.4") writes "v1.4.0".
 */
export function buildPatchColumns(line: MilestoneColumn, patches: readonly string[]): MilestoneColumn[] {
	return patches.map((p) => ({
		key: p,
		display: p,
		writeValue: canonicalVersion(p),
		order: line.order,
		isPatch: true,
		line: line.key,
	}));
}

/**
 * The sequence a Release Plan position belongs to, in display order: the whole
 * line for a patch column of an expanded line (one order per line), the
 * column's own cards otherwise. Archived cards are never part of one.
 */
export function orderingScope<C extends CardData>(
	cards: readonly C[],
	col: Pick<MilestoneColumn, "key" | "isPatch" | "line">
): C[] {
	const line = col.isPatch && col.line !== undefined ? col.line : undefined;
	return cards
		.filter(
			(c) =>
				!isArchivedCard(c) &&
				(line !== undefined ? versionKey(c.version) === line : inColumn(c, col))
		)
		.sort(compareReleaseOrder);
}
