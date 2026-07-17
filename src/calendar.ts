import { requestUrl } from "obsidian";

/**
 * Minimal ICS reader for the "upcoming meetings" strip. Read-only, fetched
 * from a user-configured secret iCal URL (device-local — never synced).
 * Supports plain events and DAILY/WEEKLY recurrence (INTERVAL, BYDAY, UNTIL,
 * COUNT, EXDATE); other frequencies contribute their master occurrence only.
 * TZID-local timestamps are treated as machine-local time — fine for
 * single-timezone teams.
 */
export interface CalendarEvent {
	start: Date;
	title: string;
	allDay: boolean;
}

function unfoldLines(text: string): string[] {
	const raw = text.split(/\r?\n/);
	const out: string[] = [];
	for (const line of raw) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

function parseIcsDate(params: string, value: string): { date: Date; allDay: boolean } | null {
	const v = value.trim();
	if (/VALUE=DATE(?:;|$)/.test(params) || /^\d{8}$/.test(v)) {
		const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
		if (!m) return null;
		return { date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), allDay: true };
	}
	const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]) - 1;
	const d = Number(m[3]);
	const h = Number(m[4]);
	const mi = Number(m[5]);
	const s = Number(m[6] ?? "0");
	return {
		date: m[7] === "Z" ? new Date(Date.UTC(y, mo, d, h, mi, s)) : new Date(y, mo, d, h, mi, s),
		allDay: false,
	};
}

const DAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type EventProps = Record<string, { params: string; value: string }[]>;

function unescapeText(value: string): string {
	return value
		.replace(/\\n/gi, " · ")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");
}

function emitEvent(props: EventProps, from: Date, to: Date, out: CalendarEvent[]): void {
	if (props.STATUS?.[0]?.value === "CANCELLED") return;
	const dtstart = props.DTSTART?.[0];
	if (!dtstart) return;
	const parsed = parseIcsDate(dtstart.params, dtstart.value);
	if (!parsed) return;
	const title = unescapeText(props.SUMMARY?.[0]?.value ?? "(untitled)");

	const exdates = new Set<number>();
	for (const ex of props.EXDATE ?? []) {
		for (const value of ex.value.split(",")) {
			const p = parseIcsDate(ex.params, value);
			if (p) exdates.add(p.date.getTime());
		}
	}

	const rrule = props.RRULE?.[0]?.value;
	if (!rrule) {
		if (
			parsed.date >= from &&
			parsed.date <= to &&
			!exdates.has(parsed.date.getTime())
		) {
			out.push({ start: parsed.date, title, allDay: parsed.allDay });
		}
		return;
	}

	const rules: Record<string, string> = {};
	for (const kv of rrule.split(";")) {
		const [k, v] = kv.split("=");
		if (k && v) rules[k.toUpperCase()] = v;
	}
	const freq = rules.FREQ;
	const interval = Math.max(1, Number(rules.INTERVAL ?? "1") || 1);
	const until = rules.UNTIL
		? (parseIcsDate(rules.UNTIL.includes("T") ? "" : "VALUE=DATE", rules.UNTIL)?.date ?? null)
		: null;
	const count = rules.COUNT ? Number(rules.COUNT) : null;

	if (freq !== "DAILY" && freq !== "WEEKLY") {
		// Unsupported recurrence — contribute the master occurrence only.
		if (parsed.date >= from && parsed.date <= to) {
			out.push({ start: parsed.date, title, allDay: parsed.allDay });
		}
		return;
	}

	const byday =
		freq === "WEEKLY" && rules.BYDAY
			? rules.BYDAY.split(",")
					.map((d) => DAY_MAP[d.trim().slice(-2)])
					.filter((n): n is number => n !== undefined)
			: null;

	const start = parsed.date;
	const startDayMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
	let emitted = 0;
	for (let t = start.getTime(), guard = 0; guard < 20000; t += 86_400_000, guard++) {
		const day = new Date(t);
		// Rebuild with DTSTART's wall-clock time so DST shifts don't drift it.
		const occ = new Date(
			day.getFullYear(),
			day.getMonth(),
			day.getDate(),
			start.getHours(),
			start.getMinutes(),
			start.getSeconds()
		);
		const daysSince = Math.round(
			(new Date(occ.getFullYear(), occ.getMonth(), occ.getDate()).getTime() - startDayMs) /
				86_400_000
		);
		let matches: boolean;
		if (freq === "DAILY") {
			matches = daysSince % interval === 0;
		} else {
			const dayOk = byday ? byday.includes(occ.getDay()) : occ.getDay() === start.getDay();
			matches = dayOk && Math.floor(daysSince / 7) % interval === 0;
		}
		if (!matches) continue;
		if (until && occ > until) break;
		emitted++;
		if (count !== null && emitted > count) break;
		if (occ > to) break;
		if (occ >= from && !exdates.has(occ.getTime())) {
			out.push({ start: occ, title, allDay: parsed.allDay });
		}
	}
}

export function parseIcs(text: string, from: Date, to: Date): CalendarEvent[] {
	const out: CalendarEvent[] = [];
	let current: EventProps | null = null;
	for (const line of unfoldLines(text)) {
		if (line === "BEGIN:VEVENT") {
			current = {};
			continue;
		}
		if (line === "END:VEVENT") {
			if (current) emitEvent(current, from, to, out);
			current = null;
			continue;
		}
		if (!current) continue;
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const left = line.slice(0, idx);
		const value = line.slice(idx + 1);
		const semi = left.indexOf(";");
		const name = (semi === -1 ? left : left.slice(0, semi)).toUpperCase();
		const params = semi === -1 ? "" : left.slice(semi + 1);
		(current[name] ??= []).push({ params, value });
	}
	out.sort((a, b) => a.start.getTime() - b.start.getTime());
	return out;
}

/** Fetch + parse the feed. Throws on network/HTTP errors — caller handles. */
export async function fetchCalendar(url: string, from: Date, to: Date): Promise<CalendarEvent[]> {
	const res = await requestUrl({ url });
	return parseIcs(res.text, from, to);
}
