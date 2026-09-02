/**
 * The plugin mirrors the calendar URL into `~/.dispatch/google.json` so the
 * fetch script can read the ICS feed — the feed's ATTACH property carries the
 * meeting document's link, which is what lets discovery avoid a Drive scope.
 *
 * That file also holds the OAuth client the user downloaded from the Cloud
 * Console and the refresh token the script minted. Losing either means redoing
 * consent, so every case here is really the same question: does the merge leave
 * everything it does not own alone?
 */
import { describe, expect, it } from "vitest";
import { CALENDAR_URL_KEY, mergeCalendarUrl } from "../src/google-config";

const URL_A = "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-111/basic.ics";
const URL_B = "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-222/basic.ics";

const credentials = {
	installed: { client_id: "123.apps.googleusercontent.com", client_secret: "GOCSPX-secret" },
	account: "someone@example.com",
	refresh_token: "1//refresh",
};

const parse = (s: string | null) => JSON.parse(s ?? "null") as Record<string, unknown>;

describe("mergeCalendarUrl", () => {
	it("creates the file when there is a URL and no config yet", () => {
		expect(parse(mergeCalendarUrl(null, URL_A))[CALENDAR_URL_KEY]).toBe(URL_A);
	});

	it("preserves the OAuth client and refresh token", () => {
		const merged = parse(mergeCalendarUrl(JSON.stringify(credentials), URL_A));
		expect(merged.installed).toEqual(credentials.installed);
		expect(merged.refresh_token).toBe("1//refresh");
		expect(merged.account).toBe("someone@example.com");
		expect(merged[CALENDAR_URL_KEY]).toBe(URL_A);
	});

	it("updates a URL that changed", () => {
		const before = JSON.stringify({ ...credentials, [CALENDAR_URL_KEY]: URL_A });
		expect(parse(mergeCalendarUrl(before, URL_B))[CALENDAR_URL_KEY]).toBe(URL_B);
	});

	it("writes nothing when the URL is already correct", () => {
		// saveLocal() runs on every settings change; rewriting an unchanged file
		// would churn one another process may be reading.
		const before = JSON.stringify({ ...credentials, [CALENDAR_URL_KEY]: URL_A });
		expect(mergeCalendarUrl(before, URL_A)).toBeNull();
	});

	it("writes nothing when there is no URL and no key", () => {
		// Most users never set a calendar URL; they should not get a google.json
		// created behind their back.
		expect(mergeCalendarUrl(null, "")).toBeNull();
		expect(mergeCalendarUrl(JSON.stringify(credentials), "")).toBeNull();
	});

	it("removes the key when the setting is cleared", () => {
		// A stale secret must not outlive the value it was copied from.
		const before = JSON.stringify({ ...credentials, [CALENDAR_URL_KEY]: URL_A });
		const merged = parse(mergeCalendarUrl(before, ""));
		expect(CALENDAR_URL_KEY in merged).toBe(false);
		expect(merged.refresh_token).toBe("1//refresh");
	});

	it("trims whitespace, and treats a blank value as cleared", () => {
		expect(parse(mergeCalendarUrl(null, `  ${URL_A}  `))[CALENDAR_URL_KEY]).toBe(URL_A);
		expect(mergeCalendarUrl(JSON.stringify(credentials), "   ")).toBeNull();
	});

	it("refuses to touch a file it cannot parse", () => {
		// Far more likely a half-written or hand-edited config than something to
		// overwrite — and it may hold the client secret. Losing the convenience
		// beats losing the credentials.
		expect(mergeCalendarUrl("{ not json", URL_A)).toBeNull();
		expect(mergeCalendarUrl("[1,2,3]", URL_A)).toBeNull();
		expect(mergeCalendarUrl("null", URL_A)).toBeNull();
	});

	it("treats an empty file as absent rather than malformed", () => {
		expect(parse(mergeCalendarUrl("", URL_A))[CALENDAR_URL_KEY]).toBe(URL_A);
		expect(parse(mergeCalendarUrl("   ", URL_A))[CALENDAR_URL_KEY]).toBe(URL_A);
	});

	it("ends with a newline, like every other config this repo writes", () => {
		expect(mergeCalendarUrl(null, URL_A)?.endsWith("\n")).toBe(true);
	});
});
