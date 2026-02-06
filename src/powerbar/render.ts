/**
 * Rendering logic for the powerbar.
 *
 * Builds a single line with left-aligned and right-aligned segments,
 * joined by themed separators. Supports inline progress bars using
 * block characters (█ + partials ▏▎▍▌▋▊▉).
 */

import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { PowerbarSettings } from "./settings.js";

export interface Segment {
	id: string;
	/** Primary text, rendered before the bar. */
	text: string;
	/** Text rendered after the bar (e.g., "59%"). */
	suffix?: string;
	icon?: string;
	color?: string;
	/** If set, renders a progress bar. Value is 0–100. */
	bar?: number;
}

/**
 * Render a progress bar using full-height block characters.
 *
 * █ for filled blocks, ▏▎▍▌▋▊▉ for partial, space for empty.
 * Matches the pi-sub visual style.
 */
function renderProgressBar(percent: number, width: number, theme: Theme, color: string): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filledFloat = (clamped / 100) * width;
	const filledFull = Math.floor(filledFloat);
	const remainder = filledFloat - filledFull;

	// Partial block levels: ▏(1/8) ▎(2/8) ▍(3/8) ▌(4/8) ▋(5/8) ▊(6/8) ▉(7/8)
	const levels = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"];

	const themeColor = color as ThemeColor;
	const filledStr = "█".repeat(filledFull);

	let partial = "";
	let emptyCount = width - filledFull;

	if (remainder >= 0.0625 && filledFull < width) {
		const levelIndex = Math.max(0, Math.min(levels.length - 1, Math.round(remainder * 8) - 1));
		partial = levels[levelIndex];
		emptyCount = Math.max(0, emptyCount - 1);
	}

	const emptyStr = " ".repeat(emptyCount);

	return theme.fg(themeColor, filledStr + partial) + emptyStr;
}

/**
 * Render a single segment.
 *
 * Layout: [icon] [text] [bar] [suffix]
 */
function renderSegmentText(segment: Segment, settings: PowerbarSettings, theme: Theme): string {
	const parts: string[] = [];
	const themeColor = (segment.color || "muted") as ThemeColor;

	if (segment.icon) {
		parts.push(theme.fg(themeColor, segment.icon));
	}

	if (segment.text) {
		parts.push(theme.fg(themeColor, segment.text));
	}

	if (segment.bar !== undefined) {
		parts.push(renderProgressBar(segment.bar, settings.barWidth, theme, segment.color || "muted"));
	}

	if (segment.suffix) {
		parts.push(theme.fg(themeColor, segment.suffix));
	}

	return parts.join(" ");
}

function renderSide(ids: string[], segments: Map<string, Segment>, settings: PowerbarSettings, theme: Theme): string {
	const rendered: string[] = [];
	for (const id of ids) {
		const seg = segments.get(id);
		if (!seg || (!seg.text && !seg.suffix && seg.bar === undefined)) continue;
		rendered.push(renderSegmentText(seg, settings, theme));
	}
	return rendered.join(theme.fg("dim", settings.separator));
}

export function renderBar(
	segments: Map<string, Segment>,
	settings: PowerbarSettings,
	theme: Theme,
	width: number,
): string {
	const leftStr = renderSide(settings.left, segments, settings, theme);
	const rightStr = renderSide(settings.right, segments, settings, theme);

	const leftWidth = visibleWidth(leftStr);
	const rightWidth = visibleWidth(rightStr);

	const padding = Math.max(1, width - leftWidth - rightWidth);

	return `${leftStr}${" ".repeat(padding)}${rightStr}`;
}
