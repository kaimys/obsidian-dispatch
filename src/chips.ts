import { App, Modal, Notice, TFile, parseYaml, setIcon } from "obsidian";
import { launchDetached, quoteArg, shellVars, substitute, writePromptFile } from "./exec";
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
	tool?: string;
	repo?: string;
	prompt?: string;
}

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
		setIcon(icon, "zap");
		chip.createSpan({ text: spec.label ?? spec.tool ?? "Run" });
		chip.addEventListener("click", () =>
			launchChip(
				plugin,
				{
					label: spec?.label ?? "Run",
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
	const toolName = spec.tool || plugin.shared.chips.defaultTool;
	const tool = plugin.local.tools[toolName];
	if (!tool || !tool.command.trim()) {
		new Notice(
			`Dispatch: tool "${toolName}" is not configured on this device (Settings → Dispatch → This device).`
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

	const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
	const fm =
		file instanceof TFile
			? plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
			: {};
	const id = fm[plugin.shared.board.titleProperty];
	const status = fm[plugin.shared.board.statusProperty];
	const title = sourcePath.replace(/^.*\//, "").replace(/\.md$/, "");
	const values: Record<string, string> = {
		file: sourcePath,
		title,
		vault: plugin.getVaultBasePath(),
		id: id === undefined || id === null ? "" : String(id),
		status: typeof status === "string" ? status : "",
	};

	// A referenced variable that resolves empty would launch a broken command
	// (e.g. "/refine " without a ticket ID) — fail loudly instead.
	const missing = [...spec.prompt.matchAll(/\{\{(\w+)\}\}/g)]
		.map((m) => m[1])
		.filter((name) => name in values && values[name].trim() === "");
	if (missing.length > 0) {
		new Notice(
			`Dispatch: "${spec.label}" not launched — {{${missing.join("}}, {{")}}} is empty on this note. ` +
				`Fix the note's frontmatter (see the board's ⚠ panel).`,
			8000
		);
		return;
	}
	const prompt = substitute(spec.prompt, values);

	const vars = shellVars({ cwd });
	vars.prompt = quoteArg(prompt); // no {{promptRaw}} on purpose — injection guard
	if (tool.command.includes("promptFile")) {
		const promptFile = writePromptFile(prompt);
		vars.promptFile = quoteArg(promptFile);
		vars.promptFileRaw = promptFile;
	}
	const command = substitute(tool.command, vars);

	const launch = () => {
		// Run lifecycle: record the launch; the agent's lifecycle hooks (in the
		// target repo) append "running"/"done" via the env vars below.
		const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const startedIso = new Date().toISOString();
		plugin.runs.append({
			id: runId,
			file: sourcePath,
			label: spec.label,
			state: "launched",
			ts: startedIso,
		});
		const vaultBase = plugin.getVaultBasePath();
		const env: Record<string, string> = {
			DISPATCH_RUN_ID: runId,
			DISPATCH_RUNS_FILE: plugin.runs.path(),
			DISPATCH_NOTE: vaultBase ? `${vaultBase}\\${sourcePath.replace(/\//g, "\\")}` : "",
			DISPATCH_LABEL: spec.label,
			DISPATCH_STARTED: startedIso,
		};
		launchDetached(
			command,
			cwd,
			(err) => new Notice(`Dispatch: failed to launch ${toolName}: ${err.message}`, 8000),
			env
		);
		new Notice(`Dispatch: launched ${toolName}`);
	};

	if (plugin.local.confirmBeforeRun) {
		new ConfirmModal(plugin.app, `Run ${toolName}?`, command, cwd, launch).open();
	} else {
		launch();
	}
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		private heading: string,
		private command: string,
		private cwd: string,
		private onConfirm: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.createDiv({
			cls: "dispatch-confirm-label",
			text: `Working directory: ${this.cwd}`,
		});
		this.contentEl.createEl("pre", { cls: "dispatch-confirm-command", text: this.command });

		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const run = row.createEl("button", { cls: "mod-cta", text: "Run" });
		run.addEventListener("click", () => {
			this.close();
			this.onConfirm();
		});
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
