import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests read powerbar settings through PI_CODING_AGENT_DIR; keep the developer's real settings out.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "powerbar-test-"));
