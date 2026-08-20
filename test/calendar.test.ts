/**
 * ICS parsing for the Meetings tab's upcoming strip. Real calendar feeds fold
 * long lines, repeat weekly with exceptions, and carry events that were moved
 * or cancelled — all of which decide whether a meeting shows up once, twice,
 * or not at all.
 */
import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/calendar";

const FROM = new Date("2026-08-01T00:00:00Z");
const TO = new Date("2026-09-01T00:00:00Z");

function ics(...vevents: string[]): string {
	return ["BEGIN:VCALENDAR", "VERSION:2.0", ...vevents, "END:VCALENDAR"].join("\r\n");
}

function titlesOn(events: { start: Date; title: string }[], day: string): string[] {
	return events.filter((e) => e.start.toISOString().slice(0, 10) === day).map((e) => e.title);
}

describe("parseIcs", () => {
	it("reads a single timed event inside the window", () => {
		const events = parseIcs(
			ics(
				[
					"BEGIN:VEVENT",
					"UID:a@example.com",
					"DTSTART:20260804T090000Z",
					"SUMMARY:Product Weekly",
					"END:VEVENT",
				].join("\r\n")
			),
			FROM,
			TO
		);
		expect(events).toHaveLength(1);
		expect(events[0].title).toBe("Product Weekly");
		expect(events[0].allDay).toBe(false);
	});

	it("ignores events outside the window", () => {
		const events = parseIcs(
			ics(
				["BEGIN:VEVENT", "UID:b", "DTSTART:20260701T090000Z", "SUMMARY:Old", "END:VEVENT"].join(
					"\r\n"
				)
			),
			FROM,
			TO
		);
		expect(events).toEqual([]);
	});

	it("unfolds a summary split across lines by the feed", () => {
		// RFC 5545 folds at 75 octets; the continuation starts with a space.
		const events = parseIcs(
			ics(
				[
					"BEGIN:VEVENT",
					"UID:c",
					"DTSTART:20260804T090000Z",
					"SUMMARY:Product Weekly — scope review and",
					"  release planning",
					"END:VEVENT",
				].join("\r\n")
			),
			FROM,
			TO
		);
		expect(events[0].title).toBe("Product Weekly — scope review and release planning");
	});

	it("expands a weekly recurrence across the window", () => {
		const events = parseIcs(
			ics(
				[
					"BEGIN:VEVENT",
					"UID:d",
					"DTSTART:20260804T090000Z",
					"RRULE:FREQ=WEEKLY;BYDAY=TU",
					"SUMMARY:Weekly",
					"END:VEVENT",
				].join("\r\n")
			),
			FROM,
			TO
		);
		// Tuesdays in August 2026: 4th, 11th, 18th, 25th.
		expect(events.map((e) => e.start.toISOString().slice(0, 10))).toEqual([
			"2026-08-04",
			"2026-08-11",
			"2026-08-18",
			"2026-08-25",
		]);
	});

	it("honours COUNT and EXDATE", () => {
		const events = parseIcs(
			ics(
				[
					"BEGIN:VEVENT",
					"UID:e",
					"DTSTART:20260804T090000Z",
					"RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3",
					"EXDATE:20260811T090000Z",
					"SUMMARY:Weekly",
					"END:VEVENT",
				].join("\r\n")
			),
			FROM,
			TO
		);
		expect(events.map((e) => e.start.toISOString().slice(0, 10))).toEqual([
			"2026-08-04",
			"2026-08-18",
		]);
	});

	it("shows a moved occurrence once, at its new time", () => {
		// A master series plus a RECURRENCE-ID override for one week: the
		// board must not list both the original slot and the moved one.
		const events = parseIcs(
			ics(
				[
					"BEGIN:VEVENT",
					"UID:f",
					"DTSTART:20260804T090000Z",
					"RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2",
					"SUMMARY:Weekly",
					"END:VEVENT",
				].join("\r\n"),
				[
					"BEGIN:VEVENT",
					"UID:f",
					"RECURRENCE-ID:20260811T090000Z",
					"DTSTART:20260812T090000Z",
					"SUMMARY:Weekly (moved)",
					"END:VEVENT",
				].join("\r\n")
			),
			FROM,
			TO
		);
		expect(titlesOn(events, "2026-08-11")).toEqual([]);
		expect(titlesOn(events, "2026-08-12")).toEqual(["Weekly (moved)"]);
		expect(events).toHaveLength(2);
	});

	it("treats a DATE-valued start as an all-day event", () => {
		const events = parseIcs(
			ics(
				[
					"BEGIN:VEVENT",
					"UID:g",
					"DTSTART;VALUE=DATE:20260814",
					"SUMMARY:Offsite",
					"END:VEVENT",
				].join("\r\n")
			),
			FROM,
			TO
		);
		expect(events[0].allDay).toBe(true);
		expect(events[0].title).toBe("Offsite");
	});
});
