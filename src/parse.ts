/**
 * Pure parsing and ordering helpers shared by the boards.
 *
 * Nothing here touches the Obsidian API, so every rule the boards depend on —
 * owner attribution, version normalization, ordering — is directly testable
 * against fixture text.
 */

/**
 * Resolve a bold owner label to a canonical assignee. With a configured
 * `assignees` list, only names matching one (by full or first-word match)
 * count — so `**US00055:**` / `**Friday:**` are NOT owners. Empty list =
 * permissive (any bold label is accepted, as before). null = no match.
 */
export function resolveAssignee(
	candidate: string | null | undefined,
	assignees: string[]
): string | null {
	if (!candidate) return null;
	const c = candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
	if (!c) return null;
	if (assignees.length === 0) return candidate.trim(); // permissive
	const first = c.split(" ")[0];
	for (const a of assignees) {
		const an = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
		if (an === c || an.split(" ")[0] === first) return a;
	}
	return null;
}

/**
 * Owners of unchecked action items in a meeting note: a bold-only line
 * (`**Alex**`) sets the owner context for following items; an inline
 * `- [ ] **Alex:** …` prefix overrides. Anything not resolving to a known
 * assignee falls back to `fallback` (e.g. "Team").
 */
export function parseOpenActionOwners(
	content: string,
	assignees: string[],
	fallback: string
): string[] {
	const owners: string[] = [];
	let context: string | null = null;
	for (const line of content.split(/\r?\n/)) {
		if (/^#{1,6}\s/.test(line)) {
			context = null;
			continue;
		}
		const section = line.match(/^\*\*([^*:]{1,40}?):?\*\*\s*$/);
		if (section) {
			// A bold-only line is a section header — it always (re)sets the
			// owner: to the known assignee, or null (→ fallback) when it's
			// something like **Team** or **US00055** that isn't one.
			context = resolveAssignee(section[1], assignees);
			continue;
		}
		const task = line.match(/^\s*[-*]\s+\[ \]\s+(.*)$/);
		if (!task) continue;
		const inlineM = task[1].match(/^\*\*([^*:]{1,40}?):?\*\*/);
		const inline = inlineM ? resolveAssignee(inlineM[1], assignees) : null;
		owners.push(inline ?? context ?? fallback);
	}
	return owners;
}

/**
 * Unchecked `- [ ]` items inside allowlisted sections. Owner attribution:
 * bold-only line (`**Alex**`) sets the context, inline `**Alex:**` prefix
 * overrides, then the note-level assignee, then `fallback` — but only labels
 * resolving to a known assignee count (a non-matching inline prefix like
 * `**US00055:**` stays as item text).
 */
export function parseTodoItems(
	content: string,
	sections: Set<string>,
	assignees: string[],
	fallback: string,
	noteAssignee: string | null
): { line: number; text: string; owner: string }[] {
	const out: { line: number; text: string; owner: string }[] = [];
	let inSection = false;
	let context: string | null = null;
	const noteOwner = resolveAssignee(noteAssignee, assignees);
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const heading = line.match(/^#{1,6}\s+(.*?)\s*$/);
		if (heading) {
			const title = heading[1].replace(/[*_`]/g, "").trim().toLowerCase();
			inSection = [...sections].some((s) => title.startsWith(s));
			context = null;
			continue;
		}
		if (!inSection) continue;
		const bold = line.match(/^\*\*([^*:]{1,40}?):?\*\*\s*$/);
		if (bold) {
			// Section header always resets the owner (null → fallback for
			// **Team** and other non-assignee headers).
			context = resolveAssignee(bold[1], assignees);
			continue;
		}
		const task = line.match(/^\s*[-*]\s+\[ \]\s+(.*)$/);
		if (!task) continue;
		let text = task[1].trim();
		const inlineM = text.match(/^\*\*([^*:]{1,40}?):?\*\*\s*/);
		let inlineOwner: string | null = null;
		if (inlineM) {
			const r = resolveAssignee(inlineM[1], assignees);
			if (r) {
				inlineOwner = r;
				text = text.slice(inlineM[0].length).trim(); // strip only a real owner prefix
			}
		}
		out.push({ line: i, text, owner: inlineOwner ?? context ?? noteOwner ?? fallback });
	}
	return out;
}

/**
 * Render a frontmatter value as display text. Frontmatter is whatever the
 * writer typed, so a value can be a nested object — which must never reach the
 * UI as "[object Object]". Lists render as their items; objects render as
 * nothing, which the callers treat as "no value".
 */
export function displayValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) {
		return value
			.map(displayValue)
			.filter((s) => s !== "")
			.join(",");
	}
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	// objects, symbols, functions: nothing a person would want to read
	return "";
}

/** Slice key for a frontmatter value: empty/missing collapses to "(none)". */
export function sliceKey(value: unknown): string {
	const text = displayValue(value);
	return text === "" ? "(none)" : text;
}

/** Normalize a version value to its major.minor key ("v1.2.0" → "1.2"). */
export function versionKey(raw: string): string {
	const m = raw.trim().match(/^[vV]?(\d+)\.(\d+)/);
	return m ? `${m[1]}.${m[2]}` : raw.trim();
}

/**
 * Full version key including the patch ("v1.4.2" → "1.4.2"). A value without
 * a patch component collapses to its line key ("v1.4" → "1.4"), so it still
 * gets a column of its own when the line is expanded.
 */
export function patchKey(raw: string): string {
	const m = raw.trim().match(/^[vV]?(\d+)\.(\d+)(?:\.(\d+))?/);
	if (!m) return raw.trim();
	return m[3] !== undefined ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}`;
}

/** Order patch keys within a line; the bare line key ("1.4") sorts first. */
export function comparePatchKeys(a: string, b: string): number {
	const pa = Number(a.split(".")[2] ?? -1);
	const pb = Number(b.split(".")[2] ?? -1);
	return pa - pb;
}

/** Ranked cards first (ascending); unranked sort after, order preserved. */
export function compareRanks(a?: number, b?: number): number {
	if (a !== undefined && b !== undefined) return a - b;
	if (a !== undefined) return -1;
	if (b !== undefined) return 1;
	return 0;
}
