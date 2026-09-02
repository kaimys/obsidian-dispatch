#!/usr/bin/env node
/**
 * Fetch a Google Meet meeting's Gemini document into the vault (US00001).
 *
 * Usage
 * -----
 *   node scripts/dispatch/meet-fetch.mjs --auth
 *       One-time consent. Opens a loopback OAuth flow and stores the refresh
 *       token in ~/.dispatch/google.json. Every later run is non-interactive.
 *
 *   node scripts/dispatch/meet-fetch.mjs --title "<meeting title>" \
 *        --date YYYY-MM-DD --dir <folder>
 *       Finds the meeting's document by title + date, exports it as Markdown
 *       and writes it into <folder>. Prints one line per outcome.
 *
 *   --dry-run   report what would be fetched, write nothing
 *
 * What Google actually produces
 * -----------------------------
 * ONE Google Doc per meeting: `<Title> - YYYY/MM/DD HH:MM TZ - Notes by Gemini`,
 * holding the Gemini summary followed by the full transcript with speaker
 * labels. There is no separate "Transcript by Gemini" file any more — see
 * US00001's 2026-09-02 correction. A meeting recorded with note-taking but
 * without transcription yields the same document minus the dialogue, which is
 * why the transcript check is on content, not on a filename.
 *
 * Scopes
 * ------
 *   drive.meet.readonly   discovery — files.list over Meet-created files
 *   documents.readonly    content — without it files.export returns 404 while
 *                         files.list and files.get both still return 200
 * `drive.readonly` is deliberately NOT requested: it would grant read of the
 * entire Drive to fetch one document.
 *
 * Config: ~/.dispatch/google.json — account-scoped rather than per-vault, so
 * one Google account serves every project (ADR-0024). Google's own downloaded
 * client JSON works unmodified. Nothing is ever written into the vault except
 * the finished document.
 *
 * Zero dependencies. Node 18+.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG = join(homedir(), ".dispatch", "google.json");
const SCOPES = [
	"https://www.googleapis.com/auth/drive.meet.readonly",
	"https://www.googleapis.com/auth/documents.readonly",
].join(" ");

// `console` is off-limits repo-wide (the Obsidian plugin ruleset lints scripts/
// too); the other scripts here write through process.stdout for the same reason.
const say = (m = "") => process.stdout.write(`${m}\n`);

// ───────────────────────────────────────────────────────────── the pure core
// Everything below this line is free of network and filesystem side effects
// except where stated, so the tests can assert it without stubbing Google.

/**
 * `<Title> - YYYY/MM/DD HH:MM TZ - Notes by Gemini` → its parts, or null.
 *
 * Two spellings exist and both are seen: Drive stores the date with slashes and
 * colons, and anything written to disk has them replaced (they are illegal in a
 * Windows filename), so a file fetched earlier parses back with underscores.
 */
export function parseArtifactName(name) {
	const m = /^(.+?) - (\d{4})[/_](\d{2})[/_](\d{2})[ _](\d{2})[:_](\d{2})(?:[ _]([A-Za-z]{2,5}))?(?: - (.+?))?$/.exec(
		String(name).replace(/\.md$/i, "").trim()
	);
	if (!m) return null;
	const [, title, y, mo, d, h, mi, tz, label] = m;
	return {
		title: title.trim(),
		date: `${y}-${mo}-${d}`,
		time: `${h}:${mi}`,
		tz: tz || "",
		label: (label || "").trim(),
	};
}

/** Google's label for the artifact, normalised. Recorded, never matched on. */
export function artifactKind(label) {
	if (/transcript|transkript/i.test(label || "")) return "transcript";
	if (/notes|notizen/i.test(label || "")) return "notes";
	return "document";
}

/** Comparable form of a meeting title: case-, accent- and punctuation-blind. */
function normaliseTitle(title) {
	return String(title)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * Title + date identify a meeting, per the recorded decision — not the Meet
 * code, which never reaches the plugin (src/calendar.ts discards it).
 *
 * `when` is `YYYY-MM-DD`, optionally with ` HH:MM`. The time is what separates
 * a recurring meeting held twice in one day; omit it and any meeting that day
 * matches, which is the common case and the one the board's `meeting_date`
 * property can express.
 */
export function matchesMeeting(parsed, title, when) {
	if (!parsed) return false;
	if (normaliseTitle(parsed.title) !== normaliseTitle(title)) return false;
	if (!when) return true;
	const [date, time] = String(when).trim().split(/[ T]/);
	if (date && parsed.date !== date) return false;
	if (time && parsed.time !== time.slice(0, 5)) return false;
	return true;
}

/**
 * The `doc_id` of every document already in `dir`.
 *
 * The presence check is by id and not by filename, so renaming a fetched file
 * does not cause a re-download, and Google renaming its artifacts again does
 * not either. Reads the directory; that is the one side effect down here.
 */
export function scanFetched(dir) {
	const ids = new Set();
	if (!existsSync(dir)) return ids;
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".md")) continue;
		const head = readFileSync(join(dir, file), "utf8").slice(0, 2000);
		const m = /^doc_id:\s*(\S+)\s*$/m.exec(head);
		if (m) ids.add(m[1]);
	}
	return ids;
}

/** The frontmatter block that makes a fetched file recognisable next time. */
export function renderFrontmatter(meta) {
	return [
		"---",
		`meeting_date: ${meta.meeting_date}`,
		`artifact: ${meta.artifact}`,
		`doc_id: ${meta.doc_id}`,
		`fetched: ${meta.fetched}`,
		"---",
		"",
	].join("\n");
}

/** The `files.list` q for a meeting title. Pure, so it is assertable. */
export function driveQuery(title) {
	const needle = String(title).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
	return [
		"mimeType = 'application/vnd.google-apps.document'",
		"trashed = false",
		`name contains '${needle}'`,
	].join(" and ");
}

/**
 * Does this export actually contain the dialogue?
 *
 * Speaker labels are the signature, not the word "transcript" — the summary
 * half mentions it in prose. Several labels rather than one, so a single bold
 * line in the notes cannot pass for a transcript.
 */
export function hasTranscriptSection(body) {
	const labels = String(body).match(/^\*\*[^*\n]{2,60}:\*\*/gm);
	return (labels?.length ?? 0) >= 5;
}

/** Drive names carry characters no filesystem accepts. */
export function safeFileName(name) {
	return String(name)
		.replace(/[<>:"/\\|?*]/g, "_")
		.replace(/\s+/g, " ")
		.trim();
}

// ────────────────────────────────────────────────────────────── the I/O layer

class Failure extends Error {}

export function loadConfig(path = CONFIG) {
	if (!existsSync(path)) {
		throw new Failure(
			`No ${path}.\n` +
				`  Create the OAuth client in the Google Cloud Console (Desktop app), download\n` +
				`  its JSON unchanged to that path, then run: node scripts/dispatch/meet-fetch.mjs --auth`
		);
	}
	const raw = JSON.parse(readFileSync(path, "utf8"));
	// The console's own download nests credentials under "installed" (desktop)
	// or "web". Accept it as-is: it is what everyone has on disk, and a
	// hand-flattened copy is one more thing to get wrong.
	const cfg = { ...(raw.installed ?? raw.web ?? {}), ...raw };
	if (!cfg.client_id || !cfg.client_secret) {
		throw new Failure(`${path} has no client_id/client_secret, at the top level or under "installed".`);
	}
	return { cfg, raw, path };
}

async function tokenRequest(params) {
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Failure(
			`Google rejected the token request (HTTP ${res.status}): ${json.error_description || json.error || "unknown"}`
		);
	}
	return json;
}

/** An access token from the stored refresh token. The normal path. */
async function accessToken(cfg) {
	if (!cfg.refresh_token) {
		throw new Failure(
			`No refresh token in ${CONFIG}.\n` + `  Run: node scripts/dispatch/meet-fetch.mjs --auth`
		);
	}
	try {
		const tok = await tokenRequest({
			client_id: cfg.client_id,
			client_secret: cfg.client_secret,
			refresh_token: cfg.refresh_token,
			grant_type: "refresh_token",
		});
		return tok.access_token;
	} catch (e) {
		// A revoked or expired token surfaces here, typically long after setup
		// and inside an unrelated task — so the message has to carry the cure.
		throw new Failure(
			`${e.message}\n` +
				`  The stored refresh token is no longer valid (revoked, or the password changed).\n` +
				`  Run: node scripts/dispatch/meet-fetch.mjs --auth`
		);
	}
}

/** One-time consent over a loopback redirect, storing the refresh token. */
async function authorize(store) {
	const { cfg, raw, path } = store;
	const state = randomBytes(16).toString("hex");

	// Bind first, so the redirect URI can name the port Google must call back on.
	const server = createServer();
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const redirect = `http://127.0.0.1:${server.address().port}`;

	const code = new Promise((resolve, reject) => {
		server.on("request", (req, res) => {
			const url = new URL(req.url, redirect);
			const c = url.searchParams.get("code");
			const err = url.searchParams.get("error");
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(
				`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">` +
					(c ? "Authorised — close this tab and return to the terminal." : `Failed: ${err}`) +
					`</body>`
			);
			server.close();
			if (url.searchParams.get("state") !== state) reject(new Failure("state mismatch"));
			else if (c) resolve(c);
			else reject(new Failure(err || "no code returned"));
		});
	});

	const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	auth.searchParams.set("client_id", cfg.client_id);
	auth.searchParams.set("redirect_uri", redirect);
	auth.searchParams.set("response_type", "code");
	auth.searchParams.set("scope", SCOPES);
	auth.searchParams.set("access_type", "offline");
	auth.searchParams.set("prompt", "consent");
	auth.searchParams.set("state", state);
	if (cfg.account) auth.searchParams.set("login_hint", cfg.account);

	say(`\nOpen this URL and sign in${cfg.account ? ` as ${cfg.account}` : ""}:\n`);
	say(auth.toString());
	say(
		`\n  An "unverified app" screen is expected — Advanced -> Go to <app> (unsafe).\n` +
			`  The client is published but deliberately unverified; see docs/privacy.html.\n`
	);

	const tok = await tokenRequest({
		code: await code,
		client_id: cfg.client_id,
		client_secret: cfg.client_secret,
		redirect_uri: redirect,
		grant_type: "authorization_code",
	});
	if (!tok.refresh_token) {
		throw new Failure(
			`Google returned no refresh token. The OAuth client is probably still in\n` +
				`  "Testing" — publish it to production, or tokens expire after 7 days.`
		);
	}
	// Write back against the original shape, so the console's nested block is
	// preserved rather than replaced by a flattened copy.
	writeFileSync(path, JSON.stringify({ ...raw, refresh_token: tok.refresh_token }, null, 2) + "\n");
	say(`Refresh token stored in ${path}. Later runs need no browser.`);
}

async function driveList(token, q) {
	const url = new URL("https://www.googleapis.com/drive/v3/files");
	url.searchParams.set("q", q);
	url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime)");
	url.searchParams.set("pageSize", "50");
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		throw new Failure(`Drive search failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
	}
	return (await res.json()).files || [];
}

async function exportMarkdown(token, id) {
	const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}/export`);
	url.searchParams.set("mimeType", "text/markdown");
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (res.status === 403) {
		const text = await res.text();
		if (/exportSizeLimitExceeded/i.test(text)) {
			throw new Failure(
				`The document is over Drive's 10 MB export limit and cannot be exported as Markdown.\n` +
					`  Download it by hand from Google Docs (File -> Download -> Markdown).`
			);
		}
		throw new Failure(`Export refused (HTTP 403): ${text.slice(0, 200)}`);
	}
	if (res.status === 404) {
		// The scope split that cost the spike two iterations: files.list and
		// files.get succeed on drive.meet.readonly alone, and only the export
		// reveals that content access was never granted.
		throw new Failure(
			`Export returned 404 for a document that was found by search.\n` +
				`  This is what a missing documents.readonly scope looks like — Drive answers\n` +
				`  "not found" rather than "not permitted". Re-run --auth to consent to both scopes.`
		);
	}
	if (!res.ok) throw new Failure(`Export failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
	return await res.text();
}

// ───────────────────────────────────────────────────────────────────── the CLI

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}

export async function main() {
	const store = loadConfig();

	if (process.argv.includes("--auth")) {
		await authorize(store);
		return 0;
	}

	const title = arg("title");
	const date = arg("date");
	const dir = arg("dir");
	const dryRun = process.argv.includes("--dry-run");

	if (!title || !dir) {
		throw new Failure(
			`Usage: meet-fetch.mjs --title "<meeting title>" --date YYYY-MM-DD --dir <folder>\n` +
				`       meet-fetch.mjs --auth`
		);
	}

	const token = await accessToken(store.cfg);
	const candidates = await driveList(token, driveQuery(title));
	const match = candidates
		.map((f) => ({ file: f, parsed: parseArtifactName(f.name) }))
		.find(({ parsed }) => matchesMeeting(parsed, title, date));

	if (!match) {
		// Not a failure: a meeting whose document has not been generated yet is
		// an ordinary state, and the caller decides what to do about it.
		say(
			`No Gemini document found for "${title}"${date ? ` on ${date}` : ""} ` +
				`(${candidates.length} title match${candidates.length === 1 ? "" : "es"} considered).`
		);
		return 1;
	}

	const { file, parsed } = match;
	if (scanFetched(dir).has(file.id)) {
		say(`Already fetched: "${file.name}" (doc_id ${file.id}) — nothing to do.`);
		return 0;
	}
	if (dryRun) {
		say(`[dry-run] would fetch "${file.name}" (doc_id ${file.id}) into ${dir}`);
		return 0;
	}

	const body = await exportMarkdown(token, file.id);
	const target = join(dir, `${safeFileName(file.name)}.md`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		target,
		renderFrontmatter({
			meeting_date: parsed.date,
			artifact: artifactKind(parsed.label),
			doc_id: file.id,
			fetched: new Date().toISOString().slice(0, 10),
		}) + body
	);

	const transcript = hasTranscriptSection(body);
	say(
		`Fetched "${file.name}" -> ${target} (${body.length} bytes). ` +
			(transcript
				? `Transcript present.`
				: `NO TRANSCRIPT in this document — transcription was off for the meeting; ` +
					`only the Gemini summary is available.`)
	);
	return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	main()
		.then((code) => process.exit(code))
		.catch((e) => {
			process.stderr.write(`${e instanceof Failure ? e.message : String(e?.stack || e)}\n`);
			process.exit(1);
		});
}
