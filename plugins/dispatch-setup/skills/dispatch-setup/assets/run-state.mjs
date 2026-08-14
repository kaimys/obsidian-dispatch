#!/usr/bin/env node
/**
 * Dispatch run-lifecycle hook — reference implementation.
 *
 * Copy this file into the TARGET REPO (the one chips launch agents into), e.g.
 * `scripts/dispatch/run-state.mjs`, and wire it in that repo's
 * `.claude/settings.json`:
 *
 *   SessionStart      -> node scripts/dispatch/run-state.mjs running
 *   UserPromptSubmit  -> node scripts/dispatch/run-state.mjs running
 *   Stop              -> node scripts/dispatch/run-state.mjs waiting
 *   SessionEnd        -> node scripts/dispatch/run-state.mjs done
 *
 * What it does
 * ------------
 * Appends `{id, state, ts}` records to the machine-local runs file the plugin
 * watches ($DISPATCH_RUNS_FILE), so the board can show a live badge on the card:
 * launched -> running <-> waiting -> done.
 *
 * On "done" it also appends a durable run-log line — plus an excerpt of the
 * agent's final message — to the launching note under `## Dispatch runs`,
 * newest first. Live state stays on this machine; only the note travels with
 * the vault.
 *
 * Contract
 * --------
 * Dispatch sets these environment variables when a chip launches a tool:
 *   DISPATCH_RUN_ID     run id to report state for
 *   DISPATCH_RUNS_FILE  absolute path of the runs .jsonl to append to
 *   DISPATCH_NOTE       absolute path of the note the chip was launched from
 *   DISPATCH_LABEL      the chip's label (e.g. "Start development")
 *   DISPATCH_STARTED    ISO timestamp of the launch
 * Claude Code passes the hook payload (including `transcript_path`) as JSON on
 * stdin. No dependencies, fully synchronous, and a silent no-op in normal
 * (non-chip) sessions — this must never disturb a session.
 *
 * Zero dependencies. Node 18+.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";

const state = process.argv[2];
const id = process.env.DISPATCH_RUN_ID;
const runsFile = process.env.DISPATCH_RUNS_FILE;

// Not launched by a chip (or called without a state) — do nothing, quietly.
if (state && id && runsFile) {
	reportState(state, id, runsFile);
	if (state === "done") logRunToNote();
}

/** Append the state transition the board watches for. */
function reportState(state, id, runsFile) {
	try {
		appendFileSync(runsFile, JSON.stringify({ id, state, ts: new Date().toISOString() }) + "\n");
	} catch {
		/* never disturb the session */
	}
}

/** Append a run-log entry (+ final-message excerpt) to the launching note. */
function logRunToNote() {
	const note = process.env.DISPATCH_NOTE;
	if (!note || !existsSync(note)) return;
	try {
		// Claude Code hands the hook its payload as JSON on stdin; absent when
		// this script is invoked by hand.
		let hookInput = null;
		try {
			hookInput = JSON.parse(readFileSync(0, "utf8") || "null");
		} catch {
			/* no stdin */
		}

		const label = process.env.DISPATCH_LABEL || "run";
		const started = Date.parse(process.env.DISPATCH_STARTED || "");
		const minutes = Number.isFinite(started)
			? Math.max(1, Math.round((Date.now() - started) / 60000))
			: null;

		const now = new Date();
		const pad = (n) => String(n).padStart(2, "0");
		const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

		let entry = `- ${stamp} — ${label} (done${minutes ? `, ${minutes} min` : ""})`;
		const excerpt = lastAssistantExcerpt(hookInput?.transcript_path, 400);
		if (excerpt) entry += `\n    > ${excerpt}`;

		let content = readFileSync(note, "utf8");
		if (/^## Dispatch runs[ \t]*\r?\n/m.test(content)) {
			// Newest first, directly under the heading.
			content = content.replace(/^## Dispatch runs[ \t]*\r?\n/m, (m) => `${m}\n${entry}\n`);
		} else {
			content = `${content.replace(/\s*$/, "")}\n\n## Dispatch runs\n\n${entry}\n`;
		}
		writeFileSync(note, content);
	} catch {
		/* never disturb the session */
	}
}

/** Last assistant text from a Claude Code transcript (JSONL), flattened and truncated. */
function lastAssistantExcerpt(transcriptPath, maxLen) {
	try {
		if (!transcriptPath || !existsSync(transcriptPath)) return "";
		let text = "";
		for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
			if (!line.includes('"assistant"')) continue; // cheap prefilter
			try {
				const entry = JSON.parse(line);
				if (entry.type !== "assistant") continue;
				const content = entry.message?.content;
				if (typeof content === "string" && content.trim()) {
					text = content;
				} else if (Array.isArray(content)) {
					const parts = content.filter((c) => c.type === "text" && c.text?.trim());
					if (parts.length > 0) text = parts.map((c) => c.text).join(" ");
				}
			} catch {
				/* skip malformed line */
			}
		}
		const flat = text.replace(/\s+/g, " ").trim();
		return flat.length > maxLen ? flat.slice(0, maxLen) + "…" : flat;
	} catch {
		return "";
	}
}
