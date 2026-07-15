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
	state: string; // launched | running | done
	ts: string; // ISO timestamp
}

export interface RunStatus {
	id: string;
	file: string;
	label: string;
	state: string;
	startedTs: number;
	lastTs: number;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class RunTracker {
	private plugin: DispatchPlugin;
	private watcher: FSWatcher | null = null;
	private cache: Map<string, RunStatus> | null = null;

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

	/** Most recent run per note path (runs older than 7 days are ignored). */
	private byFile(): Map<string, RunStatus> {
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
		const byFile = new Map<string, RunStatus>();
		for (const run of byId.values()) {
			if (run.startedTs < cutoff) continue;
			const current = byFile.get(run.file);
			if (!current || run.startedTs > current.startedTs) byFile.set(run.file, run);
		}
		this.cache = byFile;
		return byFile;
	}

	latestForFile(file: string): RunStatus | undefined {
		return this.byFile().get(file);
	}
}
