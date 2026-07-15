import { FSWatcher, appendFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "fs";
import { dirname, join, basename } from "path";
import type DispatchPlugin from "./main";

/**
 * Chip-run lifecycle tracking. The plugin OBSERVES runs, it does not manage
 * them: launch records are appended here by the plugin, and state updates
 * ("running", "done") are appended by the launched agent's lifecycle hooks
 * (e.g. Claude Code SessionStart/SessionEnd hooks in the target repo). The
 * file is machine-local (next to the device settings) — live run state never
 * syncs with the vault; durable outcomes are appended to the note by the hook.
 */
export interface RunRecord {
	id: string;
	/** Vault-relative note path (present on the launch record). */
	file?: string;
	label?: string;
	/** Working directory of the run (present on the launch/queued record). */
	cwd?: string;
	state: string; // queued | launched | running | done | cancelled
	ts: string; // ISO timestamp
}

export interface RunStatus {
	id: string;
	file: string;
	label: string;
	cwd: string;
	state: string;
	startedTs: number;
	lastTs: number;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class RunTracker {
	private plugin: DispatchPlugin;
	private watcher: FSWatcher | null = null;
	private cache: { byFile: Map<string, RunStatus>; all: RunStatus[] } | null = null;

	constructor(plugin: DispatchPlugin) {
		this.plugin = plugin;
	}

	/** ~/.dispatch/runs/<vault>-<hash>.jsonl — derived from the device-settings path. */
	path(): string {
		const settingsPath = this.plugin.localSettingsPath();
		const base = basename(settingsPath).replace(/\.json$/, "");
		return join(dirname(settingsPath), "runs", `${base}.jsonl`);
	}

	start(onChange: () => void): void {
		try {
			const path = this.path();
			mkdirSync(dirname(path), { recursive: true });
			if (!existsSync(path)) writeFileSync(path, "");
			// Queued entries are held in plugin memory — anything still marked
			// queued from a previous session can never start again.
			for (const run of this.read().all) {
				if (run.state === "queued") {
					this.append({ id: run.id, state: "cancelled", ts: new Date().toISOString() });
				}
			}
			this.watcher = watch(path, () => {
				this.cache = null;
				onChange();
			});
		} catch (e) {
			console.error("Dispatch: run tracking unavailable", e);
		}
	}

	stop(): void {
		this.watcher?.close();
		this.watcher = null;
	}

	append(record: RunRecord): void {
		try {
			const path = this.path();
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, JSON.stringify(record) + "\n");
			this.cache = null;
		} catch (e) {
			console.error("Dispatch: could not record run", e);
		}
	}

	/** Parse the JSONL into per-run statuses (runs older than 7 days are dropped). */
	private read(): { byFile: Map<string, RunStatus>; all: RunStatus[] } {
		if (this.cache) return this.cache;
		const byId = new Map<string, RunStatus>();
		try {
			const raw = existsSync(this.path()) ? readFileSync(this.path(), "utf8") : "";
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				let record: RunRecord;
				try {
					record = JSON.parse(line) as RunRecord;
				} catch {
					continue;
				}
				const ts = Date.parse(record.ts);
				if (!Number.isFinite(ts)) continue;
				const existing = byId.get(record.id);
				if (!existing) {
					if (!record.file) continue; // state update for an unknown/expired run
					byId.set(record.id, {
						id: record.id,
						file: record.file,
						label: record.label ?? "run",
						cwd: record.cwd ?? "",
						state: record.state,
						startedTs: ts,
						lastTs: ts,
					});
				} else if (ts >= existing.lastTs) {
					existing.state = record.state;
					existing.lastTs = ts;
				}
			}
		} catch (e) {
			console.error("Dispatch: could not read run records", e);
		}

		const cutoff = Date.now() - MAX_AGE_MS;
		const all = [...byId.values()].filter((r) => r.startedTs >= cutoff);
		const byFile = new Map<string, RunStatus>();
		for (const run of all) {
			const current = byFile.get(run.file);
			if (!current || run.startedTs > current.startedTs) byFile.set(run.file, run);
		}
		this.cache = { byFile, all };
		return this.cache;
	}

	latestForFile(file: string): RunStatus | undefined {
		return this.read().byFile.get(file);
	}

	/**
	 * Runs considered to be occupying a working directory. Staleness caps keep
	 * a killed terminal (missed SessionEnd) from blocking a repo forever:
	 * "launched" counts for 2 h, "running" for 24 h.
	 */
	activeForCwd(cwd: string): RunStatus[] {
		const now = Date.now();
		return this.read().all.filter((run) => {
			if (run.cwd !== cwd) return false;
			if (run.state === "launched") return now - run.lastTs < 2 * 3_600_000;
			if (run.state === "running") return now - run.lastTs < 24 * 3_600_000;
			return false;
		});
	}
}
