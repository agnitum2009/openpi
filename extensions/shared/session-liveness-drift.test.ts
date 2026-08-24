/**
 * Drift guard for the session-liveness shared bus, in the child-session.test.ts
 * fail-closed idiom.
 *
 * The bus is process-global module state, and in-process subagents bind every
 * package extension a second time with mode "print" — so a bus write from a
 * child session is cross-session pollution (the exact bug class the busy-gate
 * guard in session-liveness fixed). Two layers:
 *
 * 1. Static (fail closed): no extension may import the bus module without
 *    being classified below. A new importer fails this test before it can
 *    ship an unguarded write.
 * 2. Runtime topology: every classified importer, bound as a print-mode
 *    instance and driven through the session lifecycle, must leave the bus
 *    untouched — counters, busy gate, AND the listener list.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  getSessionLiveness,
  resetSessionLiveness,
  setRunningSubagents,
  subscribeSessionLiveness,
} from "./session-liveness.ts";

/**
 * Classified bus importers and why their writes cannot come from a child
 * (print-mode) session. To add an entry: justify the gating here, then make
 * sure the print-mode topology test below stays green.
 */
const CLASSIFIED_BUS_IMPORTERS = new Map([
  [
    "session-liveness",
    "owner: subscribes for the strip; its setMainAgentBusy writes are mode/hasUI-gated (pinned in session-liveness.ui.test.ts)",
  ],
  [
    "subagents",
    "counter writer: setRunningSubagents fires from the manager view subscription, reachable only via tui-gated paths and child-excluded tools",
  ],
  [
    "workflows",
    "counter writer: setRunningWorkflows fires from updateIndicator, gated on lastContext which only a hasUI session_start can set",
  ],
]);

/** Every extension index.ts whose source imports shared/session-liveness. */
async function discoverBusImporters() {
  const extensionsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const entries = await readdir(extensionsDir, { withFileTypes: true });
  const importers = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "shared") continue;
    let source: string;
    try {
      source = await readFile(
        path.join(extensionsDir, entry.name, "index.ts"),
        "utf8",
      );
    } catch {
      continue; // not every extension has an index.ts
    }
    if (/shared\/session-liveness/.test(source)) importers.add(entry.name);
  }
  return importers;
}

type AnyHandler = (event: unknown, ctx: unknown) => void | Promise<void>;

/** Bind one factory the way a print-mode child session would. */
function bindPrintInstance(factory: (pi: ExtensionAPI) => void) {
  const handlers = new Map<string, AnyHandler[]>();
  const record = (event: string, handler: AnyHandler) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
  };
  // Registration-phase stand-in: at bind time factories may only register
  // (pi.on / pi.events.on / register*), so every other member is a no-op.
  const pi = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === "on") {
          return (event: string, handler: AnyHandler) => record(event, handler);
        }
        if (property === "events") {
          return {
            on: (event: string, handler: AnyHandler) => record(event, handler),
            emit: () => {},
          };
        }
        // Tool-surface owners reconcile their projection at bind/session time;
        // the real ExtensionAPI always answers these, so the stand-in must too
        // or the topology test fails for a reason that cannot happen in Pi.
        if (property === "getActiveTools" || property === "getAllTools") {
          return () => [];
        }
        return () => {};
      },
    },
  ) as unknown as ExtensionAPI;
  factory(pi);
  const ctx = {
    mode: "print",
    hasUI: false,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    sessionManager: {
      getLeafId: () => "leaf",
      getBranch: () => [],
      getSessionId: () => "session",
      getEntries: () => [],
    },
    ui: {
      notify() {},
      setStatus() {},
      setWidget() {},
      setWorkingMessage() {},
    },
  } as unknown as ExtensionContext;
  return {
    async emit(event: string) {
      // Print-mode sessions report agent-type diagnostics on stderr —
      // against the REAL user agent dir here, so swallow it to keep this
      // test hermetic and its output signal-only.
      const stderr = process.stderr.write.bind(process.stderr);
      const chunks: string[] = [];
      process.stderr.write = ((chunk: string | Uint8Array) => {
        chunks.push(typeof chunk === "string" ? chunk : String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        for (const handler of handlers.get(event) ?? []) {
          await handler(undefined, ctx);
        }
      } finally {
        process.stderr.write = stderr;
      }
    },
  };
}

test("every session-liveness bus importer is classified (fail closed)", async () => {
  const importers = await discoverBusImporters();
  const unclassified = [...importers].filter(
    (name) => !CLASSIFIED_BUS_IMPORTERS.has(name),
  );
  assert.deepEqual(
    unclassified,
    [],
    "new bus importer(s): classify in CLASSIFIED_BUS_IMPORTERS with a gating justification, then keep the print-mode topology test green",
  );
  const stale = [...CLASSIFIED_BUS_IMPORTERS.keys()].filter(
    (name) => !importers.has(name),
  );
  assert.deepEqual(
    stale,
    [],
    "classified importer(s) no longer import the bus: remove the stale entries",
  );
});

test("classified importers cannot write the bus from print-mode sessions", async () => {
  resetSessionLiveness();
  // Sentinel listener: proves nobody wipes the listener list either — a
  // print-mode session_start that reached resetSessionLiveness() would
  // silently detach every subscriber in the process.
  let sentinelFires = 0;
  const unsub = subscribeSessionLiveness(() => sentinelFires++);
  assert.equal(sentinelFires, 1); // subscribe fires once with current state

  for (const name of CLASSIFIED_BUS_IMPORTERS.keys()) {
    const before = JSON.stringify(getSessionLiveness());
    const module = await import(`../${name}/index.ts`);
    const instance = bindPrintInstance(module.default);
    for (const event of [
      "session_start",
      "agent_start",
      "agent_settled",
      "session_shutdown",
    ]) {
      await instance.emit(event);
    }
    assert.equal(
      JSON.stringify(getSessionLiveness()),
      before,
      `${name} polluted the shared bus from a print-mode session`,
    );
  }
  assert.equal(
    sentinelFires,
    1,
    "a print-mode instance notified or wiped bus listeners",
  );

  // The bus is still fully functional after every child topology ran.
  setRunningSubagents(1);
  assert.equal(sentinelFires, 2);
  assert.equal(getSessionLiveness().runningSubagents, 1);

  unsub();
  resetSessionLiveness();
});
