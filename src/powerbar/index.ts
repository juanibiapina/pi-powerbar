/**
 * Powerbar Core Extension
 *
 * Listens for "powerbar:update" events from producer extensions,
 * maintains a segment store, and renders a powerline-style widget.
 */

import { unwatchFile, watch, watchFile } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionUIContext,
	getAgentDir,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { OrderedListOption } from "@juanibiapina/pi-extension-settings";
import { renderBar, type Segment } from "./render.js";
import { loadSettings, type PowerbarSettings, registerSettings } from "./settings.js";

interface PowerbarUpdatePayload {
	id: string;
	text?: string;
	suffix?: string;
	icon?: string;
	color?: string;
	bar?: number;
	barSegments?: number;
}

interface SegmentRegistration {
	id: string;
	label: string;
}

function segmentEquals(left: Segment | undefined, right: Segment): boolean {
	return (
		left?.text === right.text &&
		left.suffix === right.suffix &&
		left.icon === right.icon &&
		left.color === right.color &&
		left.bar === right.bar &&
		left.barSegments === right.barSegments
	);
}

export default function createExtension(pi: ExtensionAPI): void {
	const segments: Map<string, Segment> = new Map();
	const segmentCatalog: Map<string, OrderedListOption> = new Map();
	let settings: PowerbarSettings;
	let currentCtx: { ui: { setWidget: (...args: any[]) => void }; hasUI: boolean } | undefined;
	let settingsWatchCleanups: (() => void)[] = [];
	// TUI instance captured when the widget is registered, used to trigger re-renders.
	let tuiRef: TUI | undefined;
	// Placement of the currently registered widget (undefined when not registered).
	let widgetPlacement: "aboveEditor" | "belowEditor" | undefined;

	// Register settings with empty options initially (no segments known yet)
	registerSettings(pi, []);

	// Listen for segment registrations from producer extensions
	pi.events.on("powerbar:register-segment", (data: unknown) => {
		const { id, label } = data as SegmentRegistration;
		segmentCatalog.set(id, { id, label });
		// Re-register settings with updated segment options
		registerSettings(pi, Array.from(segmentCatalog.values()));
	});

	function refresh(): void {
		if (!currentCtx?.hasUI) return;

		if (widgetPlacement !== settings.placement) {
			// Register the widget once (or again when placement changes). The
			// component closures read the live segments/settings maps, so
			// subsequent updates only need to trigger a re-render.
			currentCtx.ui.setWidget(
				"powerbar",
				(tui: TUI, theme: Theme): Component & { dispose?(): void } => {
					tuiRef = tui;
					return {
						render(width: number): string[] {
							const line = renderBar(segments, settings, theme, width);
							return [line];
						},
						invalidate(): void {
							// No cached state to clear
						},
					};
				},
				{ placement: settings.placement },
			);
			widgetPlacement = settings.placement;
			return;
		}

		// Widget is already registered: just trigger a re-render of the live component.
		tuiRef?.requestRender();
	}

	// Listen for segment updates from any extension
	pi.events.on("powerbar:update", (data: unknown) => {
		const payload = data as PowerbarUpdatePayload;
		if (!payload?.id) return;

		if (!payload.text && payload.bar === undefined) {
			const changed = segments.delete(payload.id);
			if (!changed) return;
		} else {
			const nextSegment: Segment = {
				id: payload.id,
				text: payload.text ?? "",
				suffix: payload.suffix,
				icon: payload.icon,
				color: payload.color,
				bar: payload.bar,
				barSegments: payload.barSegments,
			};
			if (segmentEquals(segments.get(payload.id), nextSegment)) return;
			segments.set(payload.id, nextSegment);
		}

		refresh();
	});

	function stopWatchingSettings(): void {
		for (const stop of settingsWatchCleanups) stop();
		settingsWatchCleanups = [];
	}

	function reloadSettings(cwd: string): void {
		const nextSettings = loadSettings(cwd);
		if (JSON.stringify(nextSettings) === JSON.stringify(settings)) return;
		settings = nextSettings;
		refresh();
	}

	/** Watch one settings file; returns a cleanup function (or undefined when unwatchable). */
	function watchSettingsFile(path: string, cwd: string): (() => void) | undefined {
		// Prefer native event-driven watching of the containing directory with a
		// short debounce (fs.watch is unsupported for files on some platforms).
		try {
			const dir = dirname(path);
			const name = basename(path);
			let debounceTimer: NodeJS.Timeout | undefined;
			const watcher = watch(dir, { persistent: false }, (_event, filename) => {
				if (filename !== name) return;
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => reloadSettings(cwd), 250);
			});
			return () => {
				if (debounceTimer) clearTimeout(debounceTimer);
				watcher.close();
			};
		} catch {
			// Native watching unavailable (unsupported filesystem): fall back to polling.
			watchFile(path, { interval: 1000, persistent: false }, () => reloadSettings(cwd));
			return () => unwatchFile(path);
		}
	}

	function startWatchingSettings(cwd: string): void {
		stopWatchingSettings();
		const paths = [
			join(getAgentDir(), "settings-extensions.json"),
			join(cwd, CONFIG_DIR_NAME, "settings-extensions.json"),
		];
		for (const path of paths) {
			const stop = watchSettingsFile(path, cwd);
			if (stop) settingsWatchCleanups.push(stop);
		}
	}

	function hideFooter(ctx: { ui: ExtensionUIContext; hasUI: boolean }): void {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((_tui, _theme, _footerData) => ({
			render(): string[] {
				return [];
			},
			invalidate(): void {},
		}));
	}

	pi.on("session_start", async (_event, ctx) => {
		settings = loadSettings(ctx.cwd);
		currentCtx = ctx;
		// The TUI clears extension widgets between sessions, so (re)register.
		tuiRef = undefined;
		widgetPlacement = undefined;
		hideFooter(ctx);
		refresh();
		if (ctx.hasUI) startWatchingSettings(ctx.cwd);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopWatchingSettings();
		if (ctx.hasUI) {
			ctx.ui.setWidget("powerbar", undefined);
		}
		tuiRef = undefined;
		widgetPlacement = undefined;
		currentCtx = undefined;
	});
}
