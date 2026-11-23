import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import createSubExtension from "../src/powerbar-sub/index.ts";
import createTokensExtension from "../src/powerbar-tokens/index.ts";

function useSettings(settings) {
	const dir = mkdtempSync(join(tmpdir(), "powerbar-"));
	writeFileSync(join(dir, "settings-extensions.json"), JSON.stringify({ powerbar: settings }));
	process.env.PI_CODING_AGENT_DIR = dir;
	return dir;
}

function createPi() {
	const listeners = new Map();
	const emitted = [];
	const pi = {
		events: {
			on(event, handler) {
				listeners.set(event, [...(listeners.get(event) ?? []), handler]);
			},
			emit(event, payload) {
				emitted.push({ event, payload });
				for (const handler of listeners.get(event) ?? []) handler(payload);
			},
		},
		on(event, handler) {
			listeners.set(`pi:${event}`, [...(listeners.get(`pi:${event}`) ?? []), handler]);
		},
	};
	const fire = async (event, payload, ctx) => {
		for (const handler of listeners.get(`pi:${event}`) ?? []) await handler(payload, ctx);
	};
	return { pi, emitted, fire };
}

const last = (emitted, id) =>
	emitted.findLast((e) => e.event === "powerbar:update" && e.payload?.id === id)?.payload;

const message = (id, role, cost) => ({
	id,
	type: "message",
	message: { role, usage: { input: 100, output: 10, cost: { total: cost } } },
});

const entries = [
	message("e1", "assistant", 0.5),
	message("e2", "toolResult", 0.25),
	message("e3", "assistant", 0.25),
];
const tokensCtx = { cwd: "/nonexistent", sessionManager: { getEntries: () => entries, getLeafId: () => "e3" } };

test("tokens shows only the total cost by default", async () => {
	useSettings({});
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);
	await fire("session_start", {}, tokensCtx);
	assert.equal(last(emitted, "tokens").text, "↑300 ↓30 $1.00");
});

test("tokens splits main and subagent cost when cost-breakdown is on", async () => {
	useSettings({ "cost-breakdown": "on" });
	const { pi, emitted, fire } = createPi();
	createTokensExtension(pi);
	await fire("session_start", {}, tokensCtx);
	assert.equal(last(emitted, "tokens").text, "↑300 ↓30 $1.00 (main $0.75, sub $0.25)");
});

const kiroUsage = {
	provider: "kiro",
	displayName: "Kiro Plan",
	windows: [
		{
			label: "Credits",
			usedPercent: 154.9668,
			resetDescription: "7d",
			used: 7748.34,
			limit: 5000,
			overage: { charges: 109.93, currency: "USD" },
		},
	],
};

function subText() {
	const { pi, emitted } = createPi();
	createSubExtension(pi);
	pi.events.emit("usage-core:update-current", { state: { provider: "kiro", usage: kiroUsage } });
	return last(emitted, "sub-hourly");
}

test("sub segment shows only label, reset and percent by default", () => {
	useSettings({});
	const update = subText();
	assert.equal(update.text, "Credits 7d");
	assert.equal(update.suffix, "155%");
});

test("sub segment shows amounts and overage when enabled", () => {
	useSettings({ "sub-amounts": "on", "sub-overage": "on" });
	assert.equal(subText().text, "Credits 7748/5000 +$109.93 7d");
});

test("sub options ignore providers without amounts or overage", () => {
	useSettings({ "sub-amounts": "on", "sub-overage": "on" });
	const { pi, emitted } = createPi();
	createSubExtension(pi);
	const usage = { provider: "anthropic", windows: [{ label: "5h", usedPercent: 7, resetDescription: "1h" }] };
	pi.events.emit("usage-core:update-current", { state: { provider: "anthropic", usage } });
	assert.equal(last(emitted, "sub-hourly").text, "5h 1h");
});
