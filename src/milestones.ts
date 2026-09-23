/**
 * Release Plan column construction — pure, so the value a drop writes can be
 * asserted without a view (ADR-0016). Inputs are plain version strings.
 *
 * A numeric version line writes its highest known patch in canonical
 * "vMAJOR.MINOR.PATCH" form (ADR-0036); non-version labels ("Icebox") keep the
 * spelling they were planned or discovered with.
 */
import { comparePatchKeys, patchKey, versionKey } from "./parse";

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
