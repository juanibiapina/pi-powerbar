/**
 * Powerbar Core Extension
 *
 * Listens for "powerbar:update" events from producer extensions,
 * maintains a segment store, and renders a powerline-style widget.
 */

import type { OrderedListOption } from "@juanibiapina/pi-extension-settings";
import type { ExtensionAPI, ExtensionUIContext, Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { renderBar, type Segment } from "./render.js";
import { loadSettings, type PowerbarSettings, registerSettings } from "./settings.js";

interface PowerbarUpdatePayload {
	id: string;
	text?: string;
	suffix?: string;
	icon?: string;
	color?: string;
	bar?: number;
}

interface SegmentRegistration {
	id: string;
	label: string;
}

export default function createExtension(pi: ExtensionAPI): void {
	const segments: Map<string, Segment> = new Map();
	const segmentCatalog: Map<string, OrderedListOption> = new Map();
	let settings: PowerbarSettings;
	let currentCtx: { ui: { setWidget: (...args: any[]) => void }; hasUI: boolean } | undefined;

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

		currentCtx.ui.setWidget(
			"powerbar",
			(_tui: TUI, theme: Theme): Component & { dispose?(): void } => {
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
	}

	// Listen for segment updates from any extension
	pi.events.on("powerbar:update", (data: unknown) => {
		const payload = data as PowerbarUpdatePayload;
		if (!payload?.id) return;

		if (!payload.text && payload.bar === undefined) {
			segments.delete(payload.id);
		} else {
			segments.set(payload.id, {
				id: payload.id,
				text: payload.text ?? "",
				suffix: payload.suffix,
				icon: payload.icon,
				color: payload.color,
				bar: payload.bar,
			});
		}

		refresh();
	});

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
		settings = loadSettings();
		currentCtx = ctx;
		hideFooter(ctx);
		refresh();
	});

	pi.on("session_switch", async (_event, ctx) => {
		settings = loadSettings();
		currentCtx = ctx;
		hideFooter(ctx);
		refresh();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setWidget("powerbar", undefined);
		}
		currentCtx = undefined;
	});
}
