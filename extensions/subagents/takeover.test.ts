import assert from "node:assert/strict";
import test from "node:test";
import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { SubagentSnapshot } from "./src/domain.ts";
import type { SubagentReadModel } from "./src/manager.ts";
import {
  reconcileDashboardSelection,
  sanitizeSubagentDisplayLine,
  SubagentDashboard,
  type DashboardSelection,
} from "./src/ui/takeover.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const keys = {
  matches: (data: string, binding: string) => data === binding,
  getKeys: (binding: string) => [binding.split(".").at(-1) ?? binding],
} as unknown as KeybindingsManager;

function tui(rows = 30) {
  return {
    terminal: { rows },
    requestRender() {},
  } as unknown as TUI;
}

function snap(
  id: string,
  status: SubagentSnapshot["status"] = "running",
  overrides: Partial<SubagentSnapshot> = {},
): SubagentSnapshot {
  return {
    id,
    origin: "model",
    backend: "pi",
    title: `agent ${id}`,
    prompt: "test",
    cwd: "/tmp",
    status,
    createdAt: Date.now() - 12_000,
    meta: { backend: "pi", modelLabel: "provider/a-very-long-model-label" },
    usage: { tokens: 12_000, contextWindow: 100_000 },
    transcript: [],
    liveTools: [],
    queued: [],
    finalText: "",
    turns: 0,
    ...overrides,
  };
}

function model(subs: SubagentSnapshot[]): SubagentReadModel {
  return {
    list: () => subs,
    get: (id) => subs.find((snap) => snap.id === id),
    size: () => subs.length,
    subscribe: () => () => {},
    subscribeTo: () => () => {},
    requestSend() {},
    requestAbort() {},
    setOnSettled() {},
  };
}

function dashboard(subs: SubagentSnapshot[], rows = 30) {
  return new SubagentDashboard(
    tui(rows),
    theme,
    keys,
    model(subs),
    { index: 0 },
    () => {},
  );
}

test("picker and takeover display text cannot inject terminal controls", () => {
  assert.equal(
    sanitizeSubagentDisplayLine(
      "review\u001b]52;c;clipboard\u0007\n\u001b[31mnow\u001b[0m",
    ),
    "review now",
  );
});

test("dashboard selection follows its subagent id and falls back by row", () => {
  const selection: DashboardSelection = { id: "sa-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "sa-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `sa-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "sa-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `sa-${index + 1}` })),
    { id: "sa-8" },
    { id: "sa-9" },
  ]);
  assert.deepEqual(selection, { id: "sa-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "sa-1" }, { id: "sa-2" }]);
  assert.deepEqual(selection, { id: "sa-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});

test("dashboard box height follows its subagents and retains the old maximum", () => {
  const one = dashboard([snap("one")], 10);
  try {
    const lines = one.render(100);
    assert.equal(lines.length, 4); // border, one agent, border, hints
    assert.equal(lines.filter((line) => line.includes("agent one")).length, 1);
  } finally {
    one.dispose();
  }

  const many = dashboard(
    Array.from({ length: 12 }, (_, i) => snap(`${i}`)),
    10,
  );
  try {
    const lines = many.render(100);
    assert.equal(lines.filter((line) => line.startsWith("│")).length, 5);
  } finally {
    many.dispose();
  }
});

test("dashboard reserves a more row and shows each visible subagent", () => {
  const view = dashboard(
    Array.from({ length: 8 }, (_, i) => snap(`${i}`)),
    10,
  );
  try {
    const output = view.render(100).join("\n");
    for (const id of ["0", "1", "2", "3"]) {
      assert.match(output, new RegExp(`agent ${id}`));
    }
    assert.match(output, /… 4 more/);
  } finally {
    view.dispose();
  }
});

test("dashboard uses one status glyph and reports live activity", () => {
  const view = dashboard([
    snap("run", "running", {
      liveTools: [{ toolId: "1", name: "Bash", argsPreview: "git status" }],
    }),
    snap("done", "done"),
    snap("bad", "error"),
  ]);
  try {
    const output = view.render(100).join("\n");
    assert.match(output, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] agent run · Bash · git status/);
    assert.doesNotMatch(output, /agent run.*running/);
    assert.match(output, /✓ agent done/);
    assert.match(output, /✗ agent bad/);
  } finally {
    view.dispose();
  }
});
