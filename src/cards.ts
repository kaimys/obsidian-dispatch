/**
 * Turning notes into board data.
 *
 * Everything here is pure: it takes a file reference plus already-parsed
 * frontmatter and returns board state. Reading the vault stays in the view,
 * so these rules — which status counts, how a version is normalized, what
 * makes a ticket malformed — can be tested against fixture notes.
 */
import { compareRanks, displayValue, patchKey, versionKey } from "./parse";
import type { ColumnConfig } from "./settings";

/** The little Obsidian gives us about a file that this layer needs. */
export interface FileRef {
	path: string;
	basename: string;
}

export interface CardData<F extends FileRef = FileRef> {
	file: F;
	status: string;
	/** Display label of the card's status (column label if configured). */
	statusLabel: string;
	/** Position in the configured column order (for milestone sorting). */
	statusIdx: number;
	title: string;
	badges: string[];
	rank?: number;
	version: string;
	size: number;
	assignee?: string;
	/** Unanswered refinement questions. */
	questions?: number;
	/** Open manual test-plan items. */
	tests?: number;
	/** Discussion thread URL. */
	discussion?: string;
	/** Completion contribution (0–100) of the card's status. */
	progress?: number;
	excludedFromProgress: boolean;
	/** Parsed completion date (ms). */
	completedAt?: number;
	/** Raw frontmatter — used by the slice-by filter. */
	raw: Record<string, unknown>;
}

export interface ReleaseNote<F extends FileRef = FileRef> {
	file: F;
	date: string;
	version: string;
	/** True for the initial x.y.0 release of the line. */
	initial: boolean;
}

/** The board/milestone settings the card builder reads. */
export interface CardSettings {
	statusProperty: string;
	titleProperty: string;
	assigneeProperty: string;
	badgeProperties: string[];
	questionsProperty: string;
	testsProperty: string;
	discussionProperty: string;
	orderProperty: string;
	columns: ColumnConfig[];
	versionProperty: string;
	sizeProperty: string;
	completedProperty: string;
}

/**
 * A counter property: a non-negative integer, or undefined when unset or
 * unusable. People type these as strings often enough ("3") that a numeric
 * string counts.
 */
function parseCount(raw: unknown): number | undefined {
	if (raw === "" || raw === null || raw === undefined) return undefined;
	const n = typeof raw === "number" ? raw : Number(raw);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** Normalize a folder list: strip slashes, drop blanks. */
export function normalizeFolders(folders: string[]): string[] {
	return folders.map((f) => f.replace(/^\/+|\/+$/g, "")).filter((f) => f.length > 0);
}

/** Is this note inside one of the configured folders? */
export function inFolders(path: string, folders: string[]): boolean {
	return folders.some((folder) => path.startsWith(folder + "/"));
}

/** Build one card from a note's frontmatter. */
export function buildCard<F extends FileRef>(
	file: F,
	fm: Record<string, unknown>,
	s: CardSettings
): CardData<F> {
	const statusMeta = new Map(
		s.columns.map((c, i) => [
			c.value,
			{ idx: i, label: c.label, progress: c.progress, excluded: c.excluded === true },
		])
	);

	const rawStatus = fm[s.statusProperty];
	const status = typeof rawStatus === "string" ? rawStatus.trim() : "";

	const id = displayValue(fm[s.titleProperty]);
	const title = id !== "" ? `${id} · ${file.basename}` : file.basename;

	const badges = s.badgeProperties.map((p) => displayValue(fm[p])).filter((v) => v !== "");

	let rank: number | undefined;
	if (s.orderProperty) {
		const raw = fm[s.orderProperty];
		if (typeof raw === "number" && Number.isFinite(raw)) rank = raw;
		else if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw)))
			rank = Number(raw);
	}

	const rawVersion = fm[s.versionProperty];
	const version =
		typeof rawVersion === "string"
			? rawVersion.trim()
			: typeof rawVersion === "number"
				? String(rawVersion)
				: "";

	let size = 1;
	if (s.sizeProperty) {
		const rawSize = fm[s.sizeProperty];
		const n = typeof rawSize === "number" ? rawSize : Number(rawSize);
		if (Number.isFinite(n) && n > 0) size = n;
	}

	const rawAssignee = s.assigneeProperty ? fm[s.assigneeProperty] : undefined;
	const assignee =
		typeof rawAssignee === "string" && rawAssignee.trim() !== "" ? rawAssignee.trim() : undefined;

	let discussion: string | undefined;
	if (s.discussionProperty) {
		const rawUrl = fm[s.discussionProperty];
		if (typeof rawUrl === "string" && /^https?:\/\//.test(rawUrl.trim())) discussion = rawUrl.trim();
	}

	let completedAt: number | undefined;
	if (s.completedProperty) {
		const rawCompleted = fm[s.completedProperty];
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
		assignee,
		questions: s.questionsProperty ? parseCount(fm[s.questionsProperty]) : undefined,
		tests: s.testsProperty ? parseCount(fm[s.testsProperty]) : undefined,
		discussion,
		progress: meta?.progress,
		excludedFromProgress: meta?.excluded ?? false,
		completedAt,
		raw: fm,
	};
}

/**
 * What is wrong with this note, in the words the problems panel shows. A
 * missing required value, a template placeholder nobody filled in, or a status
 * that is not one of the configured columns.
 */
export function cardProblems(
	fm: Record<string, unknown>,
	s: { statusProperty: string; columns: ColumnConfig[]; requiredProperties: string[] }
): string[] {
	const problems: string[] = [];
	for (const prop of s.requiredProperties) {
		const value = fm[prop];
		if (value === undefined || value === null || value === "") {
			problems.push(`missing required property "${prop}"`);
		} else if (typeof value === "string" && /\{.+\}/.test(value)) {
			problems.push(`unrendered template value in "${prop}": ${value}`);
		}
	}
	const known = new Set(s.columns.map((c) => c.value));
	const status = fm[s.statusProperty];
	if (typeof status === "string" && status.trim() !== "" && !known.has(status.trim())) {
		problems.push(`status "${status}" is not a configured column`);
	}
	return problems;
}

/** Read a release note's frontmatter; null when it carries no version. */
export function releaseNoteFrom<F extends FileRef>(
	file: F,
	fm: Record<string, unknown>
): ReleaseNote<F> | null {
	const version = typeof fm.version === "string" ? fm.version.trim() : "";
	if (!version) return null;
	const date = typeof fm.date === "string" ? fm.date.trim() : displayValue(fm.date);
	return { file, date, version, initial: /^[vV]?\d+\.\d+\.0$/.test(version) };
}

/**
 * Index release notes for the Release Plan: one per version line (the initial
 * x.y.0 note wins, else the earliest-dated) and one per patch column.
 */
export function indexReleases<F extends FileRef>(
	notes: ReleaseNote<F>[]
): { byLine: Map<string, ReleaseNote<F>>; byPatch: Map<string, ReleaseNote<F>> } {
	const byLine = new Map<string, ReleaseNote<F>>();
	const byPatch = new Map<string, ReleaseNote<F>>();
	for (const info of notes) {
		const { version, date, initial } = info;

		const pKey = patchKey(version);
		const prevPatch = byPatch.get(pKey);
		if (!prevPatch || (date !== "" && prevPatch.date !== "" && date < prevPatch.date)) {
			byPatch.set(pKey, info);
		}

		const key = versionKey(version);
		const existing = byLine.get(key);
		if (
			!existing ||
			(!existing.initial &&
				(initial || (date !== "" && existing.date !== "" && date < existing.date)))
		) {
			byLine.set(key, info);
		}
	}
	return { byLine, byPatch };
}

/** Kanban order within a column: by rank, then title. */
export function sortByRank<F extends FileRef>(cards: CardData<F>[]): CardData<F>[] {
	return [...cards].sort((a, b) => compareRanks(a.rank, b.rank) || a.title.localeCompare(b.title));
}

/** Weighted completion of a set of cards, or null when nothing counts. */
export function milestonePercent<F extends FileRef>(cards: CardData<F>[]): number | null {
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

/**
 * Completed weight per day over the look-back window. Null when the feature is
 * off or nothing completed inside the window — the forecast never guesses.
 */
export function velocityPerDay<F extends FileRef>(
	cards: CardData<F>[],
	opts: { completedProperty: string; velocityWindowDays: number; now?: number }
): { perDay: number; samples: number } | null {
	const { completedProperty, velocityWindowDays } = opts;
	if (!completedProperty || velocityWindowDays <= 0) return null;
	const cutoff = (opts.now ?? Date.now()) - velocityWindowDays * 86_400_000;
	let weight = 0;
	let samples = 0;
	for (const card of cards) {
		if (card.completedAt === undefined || card.completedAt < cutoff) continue;
		weight += card.size;
		samples++;
	}
	if (samples === 0 || weight <= 0) return null;
	return { perDay: weight / velocityWindowDays, samples };
}
