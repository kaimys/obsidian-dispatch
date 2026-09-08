import { App, Modal, Notice, TFile, parseYaml, setIcon } from "obsidian";
import {
	emptyVars,
	launchDetached,
	quoteArg,
	resolvePrompt,
	shellVars,
	substitute,
	toolChoices,
	writePromptFile,
} from "./exec";
import { displayValue } from "./parse";
import { frontmatterOf } from "./vault";
import type DispatchPlugin from "./main";
import type { ChipTemplate } from "./settings";

/**
 * A chip block deliberately contains NO commands and NO absolute paths — it is
 * data that syncs with the vault across a team. It may only reference a tool
 * name and a repo alias; both resolve against each machine's local settings.
 *
 * ```dispatch
 * label: Refine this ticket
 * tool: claude
 * repo: my-project
 * prompt: |
 *   Refine {{file}}: read the spec and list open questions.
 * ```
 *
 * Virtual chips (settings → Chip templates) reuse the same shape and launch
 * path, but are computed per note instead of stored in markdown.
 */
interface ChipSpec {
	label?: string;
	/** Stable key for per-tool prompt overrides; a name, never a command. */
	intent?: string;
	tool?: string;
	repo?: string;
	prompt?: string;
}

/**
 * The icon on every chip launch point — the code-block button, the card and
 * meeting context menus, the column header menu and the file menu. It is the
 * outlined play triangle of the Dispatch mark (▷, U+25B7), the same glyph the
 * ribbon and the view tab carry: what a chip does is dispatch the note. One
 * constant because a user reads all of these as the same button, and seven
 * literals would drift.
 */
export const CHIP_ICON = "play";

export function registerChipProcessor(plugin: DispatchPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor("dispatch", (source, el, ctx) => {
		let spec: ChipSpec | null = null;
		let parseError = "";
		try {
			spec = parseYaml(source) as ChipSpec;
		} catch (e) {
			parseError = e instanceof Error ? e.message : String(e);
		}
		if (!spec || typeof spec !== "object" || typeof spec.prompt !== "string") {
			el.createDiv({
				cls: "dispatch-chip-error",
				text: parseError
					? `Dispatch chip: invalid YAML — ${parseError} (hint: quote values containing ":" or "#").`
					: "Dispatch chip: block must be YAML with at least a `prompt` key.",
			});
			return;
		}

		const chip = el.createEl("button", { cls: "dispatch-chip" });
		const icon = chip.createSpan({ cls: "dispatch-chip-icon" });
		setIcon(icon, CHIP_ICON);
		chip.createSpan({ text: spec.label ?? spec.tool ?? "Run" });
		chip.addEventListener("click", () =>
			launchChip(
				plugin,
				{
					label: spec?.label ?? "Run",
					intent: spec?.intent,
					tool: spec?.tool,
					repo: spec?.repo,
					prompt: spec?.prompt ?? "",
				},
				ctx.sourcePath
			)
		);
	});
}

/** Resolve + launch a chip (from a code block or a template) for a note. */
export function launchChip(plugin: DispatchPlugin, spec: ChipTemplate, sourcePath: string): void {
	const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
	const fm: Record<string, unknown> =
		file instanceof TFile ? frontmatterOf(plugin.app, file) : {};
	const id = fm[plugin.shared.board.titleProperty];
	const status = fm[plugin.shared.board.statusProperty];
	const title = sourcePath.replace(/^.*\//, "").replace(/\.md$/, "");
	const values: Record<string, string> = {
		file: sourcePath,
		title,
		vault: plugin.getVaultBasePath(),
		id: displayValue(id),
		status: typeof status === "string" ? status : "",
	};

	const vaultBase = plugin.getVaultBasePath();
	const noteAbs = vaultBase ? `${vaultBase}\\${sourcePath.replace(/\//g, "\\")}` : "";
	// `guardEmpty`: a referenced variable that resolves empty would launch a
	// broken command (e.g. "/refine " without a ticket ID). The check runs per
	// tool, because each tool may want a different prompt for this chip.
	executeChip(plugin, spec, values, sourcePath, noteAbs, true);
}

/**
 * Launch a batch chip over all tickets of a Kanban column — ONE agent session
 * working through the IDs sequentially. Run tracked under a pseudo-path (no
 * card badge, but the repo busy-gate and queue still apply).
 */
export function launchColumnChip(
	plugin: DispatchPlugin,
	spec: ChipTemplate,
	ids: string[],
	status: string
): void {
	if (ids.length === 0) {
		new Notice("Dispatch: no tickets with IDs in this column.");
		return;
	}
	const values = { ids: ids.join(" "), status, count: String(ids.length) };
	executeChip(plugin, spec, values, `(batch) ${status || "column"}`, "");
}

/**
 * Launch a chip from a calendar event (no note behind it). Prompt variables:
 * {{date}} (YYYY-MM-DD), {{title}} (event title).
 */
export function launchEventChip(
	plugin: DispatchPlugin,
	spec: ChipTemplate,
	date: string,
	title: string
): void {
	executeChip(plugin, spec, { date, title }, `(calendar) ${date}`, "");
}

/**
 * Launch the setup skill from the unconfigured board.
 *
 * Not a settings-defined chip on purpose: this is the one launch that has to
 * work with no configuration at all. It names no repo alias, so the working
 * directory falls back to the vault folder, and it takes the default tool —
 * everything else (confirmation, the one-agent-per-tree gate, the run record)
 * is the ordinary chip path, so a setup run behaves like any other run.
 */
export function launchSetup(plugin: DispatchPlugin, prompt: string): void {
	const spec: ChipTemplate = { label: "Set up Dispatch", intent: "setup", prompt };
	executeChip(plugin, spec, {}, "(setup)", "");
}

/**
 * One agent this chip could be launched with: the command that would run, or
 * the reason it cannot. Built per tool, because the tool is chosen at click
 * time (ADR-0021) and each tool may want a different prompt for the same chip.
 */
interface Candidate {
	tool: string;
	command: string;
	/** Empty when this tool can run the chip; otherwise why it cannot. */
	problem: string;
}

/** Shared launch core: tool/repo resolution, command build, busy gate, confirm, run record. */
function executeChip(
	plugin: DispatchPlugin,
	spec: ChipTemplate,
	values: Record<string, string>,
	recordFile: string,
	noteAbs: string,
	guardEmpty = false
): void {
	const choices = toolChoices(spec, plugin.local.tools, plugin.shared.chips.defaultTool);
	if (choices.length === 0) {
		const wanted = spec.tool || plugin.shared.chips.defaultTool;
		new Notice(
			`Dispatch: tool "${wanted}" is not configured on this device (Settings → Dispatch → This device).`
		);
		return;
	}

	let cwd = plugin.getVaultBasePath();
	if (spec.repo) {
		const resolved = plugin.local.repos[spec.repo];
		if (!resolved) {
			new Notice(
				`Dispatch: repository alias "${spec.repo}" is not configured on this device.`
			);
			return;
		}
		cwd = resolved;
	}
	if (!cwd) {
		new Notice("Dispatch: no working directory available (set a repo alias on the chip).");
		return;
	}

	// Build every offer up front: the dialog has to show the command each button
	// would run, which means resolving the prompt per tool before any click.
	const candidates: Candidate[] = choices.map((toolName) => {
		const template = resolvePrompt(spec, toolName, plugin.local.tools);
		const missing = guardEmpty ? emptyVars(template, values) : [];
		if (missing.length > 0) {
			return {
				tool: toolName,
				command: "",
				problem:
					`{{${missing.join("}}, {{")}}} is empty on this note. ` +
					`Fix the note's frontmatter (see the board's ⚠ panel).`,
			};
		}
		const prompt = substitute(template, values);
		const vars = shellVars({ cwd });
		vars.prompt = quoteArg(prompt); // no {{promptRaw}} on purpose — injection guard
		const commandTemplate = plugin.local.tools[toolName].command;
		if (commandTemplate.includes("promptFile")) {
			const promptFile = writePromptFile(prompt);
			vars.promptFile = quoteArg(promptFile);
			vars.promptFileRaw = promptFile;
		}
		return { tool: toolName, command: substitute(commandTemplate, vars), problem: "" };
	});

	const execute = (candidate: Candidate) => {
		// Run lifecycle: record the launch; the agent's lifecycle hooks (in the
		// target repo) append "running"/"done" via the env vars below.
		const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const startedIso = new Date().toISOString();
		plugin.runs.append({
			id: runId,
			file: recordFile,
			label: spec.label,
			cwd,
			state: "launched",
			ts: startedIso,
		});
		const env: Record<string, string> = {
			DISPATCH_RUN_ID: runId,
			// Which agent ran. The durable record of a run is the note's
			// `## Dispatch runs` line, appended by the lifecycle hook — and with
			// two agents on one board, a line that does not say who ran is not a
			// record. Set here rather than at resolution time because the agent
			// is not known until the click.
			DISPATCH_TOOL: candidate.tool,
			DISPATCH_RUNS_FILE: plugin.runs.path(),
			// The device file this vault's settings live in. A Dispatch-scope
			// script reads its own configuration out of it (ADR-0027), and it
			// cannot derive the name — a hash of the vault's absolute path — for
			// itself. Without this, a machine with more than one vault leaves the
			// script guessing, which it refuses to do, so every chip-launched
			// `/meeting report` stopped and asked for --config.
			DISPATCH_LOCAL_SETTINGS: plugin.localSettingsPath(),
			DISPATCH_NOTE: noteAbs,
			DISPATCH_LABEL: spec.label,
			DISPATCH_STARTED: startedIso,
		};
		launchDetached(
			candidate.command,
			cwd,
			(err) =>
				new Notice(`Dispatch: failed to launch ${candidate.tool}: ${err.message}`, 8000),
			env
		);
		new Notice(`Dispatch: launched ${candidate.tool}`);
	};

	// One agent per working tree: if the repo is busy (or has a queue), let
	// the user queue behind it, run anyway, or back out.
	const gate = (candidate: Candidate) => {
		const run = () => execute(candidate);
		const active = plugin.runs.activeForCwd(cwd);
		const waiting = plugin.pendingRunCount(cwd);
		if (active.length === 0 && waiting === 0) {
			run();
			return;
		}
		new BusyModal(plugin.app, active[0], waiting, cwd, {
			onQueue: () => plugin.enqueueRun(cwd, recordFile, spec.label, run),
			onRunAnyway: run,
		}).open();
	};

	// The picker lives in the confirmation dialog and nowhere else: turning
	// confirmations off means "don't make me confirm", not "show me a new
	// dialog". Without it the chip's own tool (else the default) runs, exactly
	// as before — a person who wants the other agent every time sets that.
	if (plugin.local.confirmBeforeRun && candidates.some((c) => !c.problem)) {
		new ConfirmModal(plugin.app, candidates, cwd, gate).open();
		return;
	}
	const preferred = candidates[0];
	if (preferred.problem) {
		new Notice(`Dispatch: "${spec.label}" not launched — ${preferred.problem}`, 8000);
		return;
	}
	gate(preferred);
}

class BusyModal extends Modal {
	constructor(
		app: App,
		private blocking: { label: string; file: string; state: string; lastTs: number } | undefined,
		private waiting: number,
		private cwd: string,
		private actions: { onQueue: () => void; onRunAnyway: () => void }
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Repository busy");
		const lines: string[] = [];
		if (this.blocking) {
			lines.push(
				`"${this.blocking.label}" (${this.blocking.file.replace(/^.*\//, "")}) is still ${this.blocking.state} in ${this.cwd} — since ${new Date(this.blocking.lastTs).toLocaleTimeString()}.`
			);
		}
		if (this.waiting > 0) lines.push(`${this.waiting} run(s) already queued for this repo.`);
		lines.push(
			"Two agents in the same working tree can clobber each other's changes. Queued runs start automatically when the repo frees up."
		);
		for (const line of lines) this.contentEl.createEl("p", { text: line });

		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const queue = row.createEl("button", { cls: "mod-cta", text: "Queue" });
		queue.addEventListener("click", () => {
			this.close();
			this.actions.onQueue();
		});
		const anyway = row.createEl("button", { text: "Run anyway" });
		anyway.addEventListener("click", () => {
			this.close();
			this.actions.onRunAnyway();
		});
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * The confirmation dialog, and — on a device with more than one agent — the
 * place the agent is chosen (ADR-0021). One button per configured tool, the
 * chip's own tool first and primary.
 *
 * The `<pre>` must always show the command the *next click* would run: showing
 * the exact command before it runs is the whole reason this dialog exists
 * (ADR-0004), and a preview that lags the button under the cursor would quietly
 * break that. So it repaints on hover and on focus, and focus matters as much
 * as hover — a keyboard user never generates a mouseenter.
 */
class ConfirmModal extends Modal {
	constructor(
		app: App,
		private candidates: Candidate[],
		private cwd: string,
		private onConfirm: (candidate: Candidate) => void
	) {
		super(app);
	}

	onOpen(): void {
		const single = this.candidates.length === 1;
		this.titleEl.setText(single ? `Run ${this.candidates[0].tool}?` : "Run this chip?");
		this.contentEl.createDiv({
			cls: "dispatch-confirm-label",
			text: `Working directory: ${this.cwd}`,
		});
		const preview = this.contentEl.createEl("pre", { cls: "dispatch-confirm-command" });
		const show = (c: Candidate) =>
			preview.setText(c.problem ? `Cannot run ${c.tool} — ${c.problem}` : c.command);

		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		let primaryTaken = false;
		for (const candidate of this.candidates) {
			const name = candidate.tool.charAt(0).toUpperCase() + candidate.tool.slice(1);
			const button = row.createEl("button", { text: single ? "Run" : `Run with ${name}` });
			if (candidate.problem) {
				button.disabled = true;
			} else if (!primaryTaken) {
				button.addClass("mod-cta");
				primaryTaken = true;
				show(candidate);
			}
			for (const event of ["mouseenter", "focus"]) {
				button.addEventListener(event, () => show(candidate));
			}
			button.addEventListener("click", () => {
				if (candidate.problem) return;
				this.close();
				this.onConfirm(candidate);
			});
		}
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
