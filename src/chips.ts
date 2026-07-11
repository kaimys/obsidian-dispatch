import { App, Modal, Notice, parseYaml, setIcon } from "obsidian";
import { launchDetached, quoteArg, shellVars, substitute, writePromptFile } from "./exec";
import type DispatchPlugin from "./main";

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
		try {
			spec = parseYaml(source) as ChipSpec;
		} catch {
			// handled below
		}
		if (!spec || typeof spec !== "object" || typeof spec.prompt !== "string") {
			el.createDiv({
				cls: "dispatch-chip-error",
				text: "Dispatch chip: block must be YAML with at least a `prompt` key.",
			});
			return;
		}

		const chip = el.createEl("button", { cls: "dispatch-chip" });
		const icon = chip.createSpan({ cls: "dispatch-chip-icon" });
		setIcon(icon, "zap");
		chip.createSpan({ text: spec.label ?? spec.tool ?? "Run" });
		chip.addEventListener("click", () => runChip(plugin, spec as ChipSpec, ctx.sourcePath));
	});
}

function runChip(plugin: DispatchPlugin, spec: ChipSpec, sourcePath: string): void {
	const toolName = spec.tool ?? plugin.shared.chips.defaultTool;
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

	const title = sourcePath.replace(/^.*\//, "").replace(/\.md$/, "");
	const prompt = substitute(spec.prompt ?? "", {
		file: sourcePath,
		title,
		vault: plugin.getVaultBasePath(),
	});

	const vars = shellVars({ cwd });
	vars.prompt = quoteArg(prompt); // no {{promptRaw}} on purpose — injection guard
	if (tool.command.includes("promptFile")) {
		const promptFile = writePromptFile(prompt);
		vars.promptFile = quoteArg(promptFile);
		vars.promptFileRaw = promptFile;
	}
	const command = substitute(tool.command, vars);

	const launch = () => {
		launchDetached(command, cwd, (err) =>
			new Notice(`Dispatch: failed to launch ${toolName}: ${err.message}`, 8000)
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
