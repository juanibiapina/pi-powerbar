/**
 * Settings for the powerbar via pi-extension-settings.
 */

import type { SettingDefinition } from "@juanibiapina/pi-extension-settings";
import { getSetting } from "@juanibiapina/pi-extension-settings";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const EXTENSION_NAME = "powerbar";

export const SETTINGS_DEFINITIONS: SettingDefinition[] = [
	{
		id: "left",
		label: "Left segments",
		description: "Comma-separated segment IDs for the left side",
		defaultValue: "git-branch,tokens,context-usage",
	},
	{
		id: "right",
		label: "Right segments",
		description: "Comma-separated segment IDs for the right side",
		defaultValue: "model,sub-hourly,sub-weekly",
	},
	{
		id: "separator",
		label: "Separator",
		description: "Separator between segments",
		defaultValue: " │ ",
		values: [" │ ", " ┃ ", " | ", " · ", "  "],
	},
	{
		id: "placement",
		label: "Placement",
		description: "Where the powerbar appears",
		defaultValue: "belowEditor",
		values: ["belowEditor", "aboveEditor"],
	},
	{
		id: "bar-width",
		label: "Bar width",
		description: "Width of progress bars in characters",
		defaultValue: "10",
		values: ["6", "8", "10", "12", "16"],
	},
];

export interface PowerbarSettings {
	left: string[];
	right: string[];
	separator: string;
	placement: "aboveEditor" | "belowEditor";
	barWidth: number;
}

export function registerSettings(pi: ExtensionAPI): void {
	pi.events.emit("pi-extension-settings:register", {
		name: EXTENSION_NAME,
		settings: SETTINGS_DEFINITIONS,
	});
}

export function loadSettings(): PowerbarSettings {
	const leftStr = getSetting(EXTENSION_NAME, "left", "git-branch,tokens,context-usage") ?? "";
	const rightStr = getSetting(EXTENSION_NAME, "right", "model,sub-hourly,sub-weekly") ?? "";
	const separator = getSetting(EXTENSION_NAME, "separator", " │ ") ?? " │ ";
	const placement = getSetting(EXTENSION_NAME, "placement", "belowEditor") ?? "belowEditor";
	const barWidthStr = getSetting(EXTENSION_NAME, "bar-width", "10") ?? "10";

	return {
		left: leftStr
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		right: rightStr
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		separator,
		placement: placement === "aboveEditor" ? "aboveEditor" : "belowEditor",
		barWidth: Math.max(4, Math.min(24, Number.parseInt(barWidthStr, 10) || 10)),
	};
}
