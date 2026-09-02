/**
 * `~/.dispatch/google.json` — the account-scoped device file that
 * `scripts/dispatch/meet-fetch.mjs` reads (ADR-0024).
 *
 * The plugin owns exactly one key in it, `calendar_url`, and must leave
 * everything else untouched: the OAuth client the user downloaded from the
 * Google Cloud Console lives in the same file, along with the refresh token the
 * script mints. Clobbering either would mean re-running consent.
 *
 * Kept pure and separate from `main.ts` so the merge rules are testable without
 * a filesystem or an Obsidian stub, the same way `adoption.ts` is.
 */

/** The one key the plugin writes. Snake case, matching the script's own keys. */
export const CALENDAR_URL_KEY = "calendar_url";

/**
 * The new contents of `google.json`, or **null when nothing should be written**.
 *
 * Null covers three distinct "leave it alone" cases, which matters because this
 * runs on every settings save:
 *  - the value is already what it should be, so writing would only churn a file
 *    another process may be reading;
 *  - there is no URL and no key, so there is nothing to record and no reason to
 *    create the file at all;
 *  - the existing file is not valid JSON. A malformed file is far more likely
 *    to be a half-written or hand-edited config than something to overwrite,
 *    and it may hold the client secret. Refusing to touch it loses one
 *    convenience; rewriting it could cost the user their credentials.
 */
export function mergeCalendarUrl(existing: string | null, calendarUrl: string): string | null {
	const url = calendarUrl.trim();

	let config: Record<string, unknown> = {};
	if (existing !== null && existing.trim() !== "") {
		try {
			const parsed: unknown = JSON.parse(existing);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
			config = parsed as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	const current = config[CALENDAR_URL_KEY];
	if (url === "") {
		// Clearing the setting clears the mirror, so a stale secret does not
		// outlive the value it was copied from.
		if (!(CALENDAR_URL_KEY in config)) return null;
		delete config[CALENDAR_URL_KEY];
	} else {
		if (current === url) return null;
		config[CALENDAR_URL_KEY] = url;
	}

	return JSON.stringify(config, null, 2) + "\n";
}
