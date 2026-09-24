/**
 * Retargeting a whole Release Plan line from its header — "move everything in
 * 0.4 to 0.5" — planned before anything is written (ADR-0009, extended from
 * one drop to a batch).
 *
 * The planner decides every write: one frontmatter patch per card, and the
 * new plannedVersions and tags. Every precondition (numeric destination, a
 * different line, no finished card) is checked before a single patch is
 * built, so a rejected request is exactly zero writes. The view only performs
 * a plan that came back `ok`.
 */
import type { CardData, FileRef } from "./cards";
import { buildLineColumns, isArchivedCard, isVersionLine, lineCandidates } from "./milestones";
import type { MilestoneColumn } from "./milestones";
import type { FrontmatterPatch } from "./moves";
import { versionKey } from "./parse";

const NUMERIC_VERSION = /^[vV]?(\d+)\.(\d+)(?:\.(\d+))?$/;

/**
 * The header action is offered on collapsed numeric lines only — not on patch
 * columns, (no version), (archive) or labels such as "Icebox".
 */
export function isRetargetSource(col: Pick<MilestoneColumn, "key" | "isPatch">): boolean {
	return isVersionLine(col.key) && !col.isPatch;
}

/**
 * A typed or picked destination as a line key plus optional patch, with
 * leading zeros stripped ("0.06" → "0.6"). Null for anything that is not a
 * numeric version: "Icebox", "", "v1", "next".
 */
export function parseDestination(text: string): { key: string; patch?: number } | null {
	const m = text.trim().match(NUMERIC_VERSION);
	if (!m) return null;
	const key = `${Number(m[1])}.${Number(m[2])}`;
	return m[3] === undefined ? { key } : { key, patch: Number(m[3]) };
}

/** The cards a line column shows, across every slice (archived cards stay put). */
export function retargetSourceCards<F extends FileRef>(
	cards: readonly CardData<F>[],
	sourceKey: string
): CardData<F>[] {
	return cards.filter((c) => !isArchivedCard(c) && versionKey(c.version) === sourceKey);
}

/**
 * Source cards whose status is finished (column progress ≥ 100 — Done and
 * Released on this board). Any one of them blocks the whole retarget.
 */
export function retargetBlockers<F extends FileRef>(
	cards: readonly CardData<F>[],
	sourceKey: string
): CardData<F>[] {
	return retargetSourceCards(cards, sourceKey).filter((c) => (c.progress ?? 0) >= 100);
}

/** The line columns the board would render from all cards, unsliced. */
function allLineColumns(planned: readonly string[], cards: readonly CardData[]): MilestoneColumn[] {
	const active = cards.filter((c) => !isArchivedCard(c)).map((c) => c.version);
	return buildLineColumns(planned, active, lineCandidates(planned, cards)).filter((c) =>
		isVersionLine(c.key)
	);
}

/** Existing numeric lines a source can be retargeted to: every line but its own. */
export function retargetDestinations(
	planned: readonly string[],
	cards: readonly CardData[],
	sourceKey: string
): MilestoneColumn[] {
	return allLineColumns(planned, cards).filter((c) => c.key !== sourceKey);
}

export interface RetargetInput<F extends FileRef = FileRef> {
	/** Every card on the board — not the sliced view. */
	cards: readonly CardData<F>[];
	/** The source line key ("0.4"). */
	sourceKey: string;
	/** A picked line key or typed text. */
	destination: string;
	versionProperty: string;
	plannedVersions: readonly string[];
	tags: Readonly<Record<string, string>>;
}

/** The facts a confirmation and a report print. Strings are the view's. */
export interface RetargetSummary {
	cardCount: number;
	/** Planned entries of the source line that are dropped. */
	plannedRemoved: string[];
	/** A planned source entry renumbered in place (new destination only). */
	plannedReplaced?: { from: string; to: string };
	/** The source tag carried to a new destination. */
	tagMoved?: string;
	/** The source tag dropped because the destination keeps its own. */
	tagRemoved?: string;
}

export type RetargetRejection<F extends FileRef = FileRef> =
	| { ok: false; reason: "invalid" }
	| { ok: false; reason: "same-line"; destKey: string }
	| { ok: false; reason: "protected"; blockers: CardData<F>[] };

export interface RetargetPlan<F extends FileRef = FileRef> {
	ok: true;
	sourceKey: string;
	destKey: string;
	/** The exact value every source card gets. */
	writeValue: string;
	/** True when the destination line already has a column (a merge). */
	destinationExists: boolean;
	patches: FrontmatterPatch<F>[];
	plannedVersions: string[];
	tags: Record<string, string>;
	summary: RetargetSummary;
}

/**
 * Plan a line retarget. Rejections carry no patches and no settings. An
 * existing destination writes its ADR-0036 value (a typed patch is ignored);
 * a new one writes the canonical "vMAJOR.MINOR.PATCH". Inputs are never
 * mutated.
 */
export function planRetarget<F extends FileRef>(
	input: RetargetInput<F>
): RetargetPlan<F> | RetargetRejection<F> {
	const { cards, sourceKey, versionProperty, plannedVersions, tags } = input;
	const dest = parseDestination(input.destination);
	if (!dest) return { ok: false, reason: "invalid" };
	if (dest.key === sourceKey) return { ok: false, reason: "same-line", destKey: dest.key };
	const blockers = retargetBlockers(cards, sourceKey);
	if (blockers.length > 0) return { ok: false, reason: "protected", blockers };

	const existing = retargetDestinations(plannedVersions, cards, sourceKey).find(
		(c) => c.key === dest.key
	);
	const writeValue = existing ? existing.writeValue : `v${dest.key}.${dest.patch ?? 0}`;

	const patches: FrontmatterPatch<F>[] = retargetSourceCards(cards, sourceKey).map((c) => ({
		file: c.file,
		set: { [versionProperty]: writeValue },
	}));

	const summary: RetargetSummary = { cardCount: patches.length, plannedRemoved: [] };
	const nextPlanned: string[] = [];
	for (const entry of plannedVersions) {
		if (versionKey(entry) !== sourceKey) nextPlanned.push(entry);
		else if (!existing && !summary.plannedReplaced) {
			summary.plannedReplaced = { from: entry, to: writeValue };
			nextPlanned.push(writeValue);
		} else summary.plannedRemoved.push(entry);
	}

	const nextTags: Record<string, string> = { ...tags };
	const sourceTag = nextTags[sourceKey];
	delete nextTags[sourceKey];
	if (sourceTag !== undefined) {
		if (existing) summary.tagRemoved = sourceTag;
		else {
			nextTags[dest.key] = sourceTag;
			summary.tagMoved = sourceTag;
		}
	}

	return {
		ok: true,
		sourceKey,
		destKey: dest.key,
		writeValue,
		destinationExists: existing !== undefined,
		patches,
		plannedVersions: nextPlanned,
		tags: nextTags,
		summary,
	};
}

/**
 * True when two plans write the same thing — the check a confirmed plan is
 * re-run against, since sync can change notes or settings while the dialog is
 * open and the confirmation must describe what is actually written.
 */
export function sameRetarget(a: RetargetPlan, b: RetargetPlan): boolean {
	const paths = (p: RetargetPlan) =>
		p.patches
			.map((x) => x.file.path)
			.sort()
			.join("\n");
	const tagsOf = (p: RetargetPlan) => JSON.stringify(Object.entries(p.tags).sort());
	return (
		a.writeValue === b.writeValue &&
		a.destinationExists === b.destinationExists &&
		paths(a) === paths(b) &&
		a.plannedVersions.join("\n") === b.plannedVersions.join("\n") &&
		tagsOf(a) === tagsOf(b)
	);
}
