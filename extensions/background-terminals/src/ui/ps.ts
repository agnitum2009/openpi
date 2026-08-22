/**
 * /ps UI — two-stage inspector over the synchronous TerminalReadModel:
 * - TerminalDashboard: compact picker docked above the input, listing all
 *   tracked terminals (select, kill, open).
 * - TerminalDetailView: full-screen read-only inspector for one terminal —
 *   metadata, stdout/stderr toggle, scrolling, live tail. No input surface:
 *   background terminals have no stdin by design.
 */

import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  hintLine,
  overflowNote,
  panelFrame,
  screenTitleLine,
} from "../../../shared/screen-chrome.ts";
import {
  formatDuration,
  formatElapsed,
  formatExit,
  type TerminalSnapshot,
} from "../domain.ts";
import type { TerminalReadModel } from "../manager.ts";
import { createOutputLineCache, sanitizeText } from "./output-view.ts";

/** One-line-safe rendering of model-provided text (titles, commands): a
 * newline or control char inside a fixed-height row desyncs the renderer. */
function oneLine(text: string) {
  return sanitizeText(text.replace(/\s+/g, " "));
}

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

function statusGlyph(snap: TerminalSnapshot, theme: Theme) {
  switch (snap.status) {
    case "running":
      return theme.fg("warning", "■");
    case "done":
      return theme.fg("success", "■");
    case "failed":
      return theme.fg("error", "■");
    case "killed":
      return theme.fg("muted", "■");
    case "timed_out":
      return theme.fg("error", "■");
  }
}

function statusWord(snap: TerminalSnapshot, theme: Theme) {
  switch (snap.status) {
    case "running":
      return theme.fg("warning", "running");
    case "done":
      return theme.fg("success", "done");
    case "failed":
      return theme.fg("error", "failed");
    case "killed":
      return theme.fg("muted", "killed");
    case "timed_out":
      return theme.fg("error", "timed out");
  }
}

// --- Entry point ---------------------------------------------------------------

export async function openTerminalPicker(
  ctx: ExtensionCommandContext,
  view: TerminalReadModel,
) {
  const selection: DashboardSelection = { index: 0 };

  while (true) {
    if (view.size() === 0) {
      ctx.ui.notify("No background terminals", "info");
      return;
    }

    const picked = await ctx.ui.custom<string | null>(
      (tui, theme, keybindings, done) =>
        new TerminalDashboard(tui, theme, keybindings, view, selection, done),
      {
        overlay: true,
        // Dock the picker just above the editor (editor + strip + footer ≈ 6
        // rows) like a command palette, instead of blanking the conversation.
        overlayOptions: {
          anchor: "bottom-center",
          width: "100%",
          maxHeight: "60%",
          margin: { bottom: 6 },
        },
      },
    );

    if (!picked) return;
    if (!view.get(picked)) continue;

    await ctx.ui.custom<null>(
      (tui, theme, keybindings, done) =>
        new TerminalDetailView(tui, theme, keybindings, picked, view, done),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
      },
    );
    // After leaving the detail view, fall back to the dashboard.
  }
}

// --- Dashboard (picker docked above the input) ---------------------------------

/** A picker is a glance, not a workspace: cap the list window and scroll. */
const MAX_PICKER_ROWS = 10;

export interface DashboardSelection {
  id?: string;
  index: number;
}

export function reconcileDashboardSelection(
  selection: DashboardSelection,
  terminals: ReadonlyArray<Pick<TerminalSnapshot, "id">>,
) {
  const stableIndex = selection.id
    ? terminals.findIndex((snap) => snap.id === selection.id)
    : -1;
  selection.index =
    stableIndex >= 0
      ? stableIndex
      : Math.min(
          Math.max(0, selection.index),
          Math.max(0, terminals.length - 1),
        );
  selection.id = terminals[selection.index]?.id;
}

class TerminalDashboard implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private view: TerminalReadModel;
  private selection: DashboardSelection;
  private done: (value: string | null) => void;

  private closed = false;
  private ticker: ReturnType<typeof setInterval>;
  private unsubChange: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    view: TerminalReadModel,
    selection: DashboardSelection,
    done: (value: string | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.view = view;
    this.selection = selection;
    this.done = done;
    // Elapsed times and output sizes tick along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
    this.unsubChange = view.subscribe(() => this.tui.requestRender());
  }

  private terminals(): ReadonlyArray<TerminalSnapshot> {
    return this.view.list();
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    clearInterval(this.ticker);
    this.unsubChange();
    return true;
  }

  private close(result: string | null) {
    if (this.cleanup()) this.done(result);
  }

  dispose(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    const terminals = this.terminals();
    reconcileDashboardSelection(this.selection, terminals);

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const snap = terminals[this.selection.index];
      if (snap) this.close(snap.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      if (terminals.length > 0) {
        this.selection.index =
          (this.selection.index - 1 + terminals.length) % terminals.length;
        this.selection.id = terminals[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      if (terminals.length > 0) {
        this.selection.index = (this.selection.index + 1) % terminals.length;
        this.selection.id = terminals[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (data === "x") {
      const snap = terminals[this.selection.index];
      if (snap && snap.status === "running") this.view.requestKill(snap.id);
      return;
    }
  }

  render(width: number): string[] {
    const theme = this.theme;
    const terminals = this.terminals();
    reconcileDashboardSelection(this.selection, terminals);

    // Size the panel to its content (bounded, scrolling past the cap) so the
    // docked picker never covers more conversation than the list needs.
    const bodyHeight = Math.min(Math.max(terminals.length, 1), MAX_PICKER_ROWS);
    const running = terminals.filter((s) => s.status === "running").length;
    const keys = (binding: Parameters<KeybindingsManager["getKeys"]>[0]) =>
      configuredKeys(this.keybindings, binding);

    return [
      screenTitleLine(
        theme,
        "Background terminals",
        `${terminals.length} terminal${terminals.length === 1 ? "" : "s"}`,
        width,
      ),
      ...panelFrame(theme, {
        label: `terminals · ${running}/${terminals.length} running`,
        rows: this.renderRows(terminals, width - 2, bodyHeight),
        width,
        height: bodyHeight + 2,
      }),
      hintLine(
        theme,
        [
          [`${keys("tui.select.up")}/${keys("tui.select.down")}/jk`, "select"],
          [keys("tui.select.confirm"), "inspect"],
          ["x", "kill"],
          [keys("tui.select.cancel"), "close"],
        ],
        width,
      ),
    ];
  }

  private renderRows(
    terminals: ReadonlyArray<TerminalSnapshot>,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const out: string[] = [];

    // Scroll window around selection
    let start = 0;
    if (terminals.length > height) {
      start = Math.min(
        Math.max(0, this.selection.index - Math.floor(height / 2)),
        terminals.length - height,
      );
    }
    const visible = terminals.slice(start, start + height);

    for (let i = 0; i < visible.length; i++) {
      const snap = visible[i];
      const index = start + i;
      const isSelected = index === this.selection.index;

      // Left: marker, status square, title, dim id
      const marker = isSelected ? theme.fg("accent", "❯") : " ";
      const title = isSelected
        ? theme.fg("accent", oneLine(snap.title))
        : theme.fg("text", oneLine(snap.title));
      const left = ` ${marker} ${statusGlyph(snap, theme)} ${title} ${theme.fg("dim", snap.id)}`;

      // Right: pid · elapsed · exit/status
      const dot = theme.fg("dim", " · ");
      const rightParts = [
        theme.fg("muted", `pid ${snap.pid ?? "?"}`),
        theme.fg("muted", formatElapsed(snap)),
        snap.status === "running"
          ? statusWord(snap, theme)
          : theme.fg("muted", formatExit(snap)),
        snap.status === "running" && snap.timeoutAt !== undefined
          ? theme.fg(
              "warning",
              `${formatDuration((snap.timeoutAt - Date.now()) / 1_000)} left`,
            )
          : "",
      ];
      const right = `${rightParts.filter(Boolean).join(dot)} `;

      const rightWidth = visibleWidth(right);
      const leftMax = Math.max(0, width - rightWidth - 2);
      const leftTruncated = truncateToWidth(left, leftMax);
      const gap = Math.max(2, width - visibleWidth(leftTruncated) - rightWidth);
      out.push(truncateToWidth(leftTruncated + " ".repeat(gap) + right, width));
    }

    if (start > 0) out[0] = overflowNote(theme, start, width, "above");
    if (start + height < terminals.length) {
      out[out.length - 1] = overflowNote(
        theme,
        terminals.length - start - height,
        width,
        "below",
      );
    }
    return out;
  }

  invalidate(): void {}
}

// --- Detail view (read-only inspector) --------------------------------------------

const OUTPUT_SCROLL_STEP = 6;

class TerminalDetailView implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private id: string;
  private view: TerminalReadModel;
  private done: (value: null) => void;

  /** Active output stream shown in the viewport; `t` toggles. */
  private stream: "stdout" | "stderr" = "stdout";
  /** Scroll offset in lines from the bottom. 0 = pinned to bottom (live tail). */
  private scrollOffset = 0;
  private lineCache = createOutputLineCache();
  private unsubscribe: () => void;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private ticker: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    id: string,
    view: TerminalReadModel,
    done: (value: null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.id = id;
    this.view = view;
    this.done = done;
    this.unsubscribe = view.subscribeTo(id, () => this.scheduleRender());
    // Elapsed time in the header ticks along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
  }

  private snap(): TerminalSnapshot | undefined {
    return this.view.get(this.id);
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    // A chatty process emits a chunk per write. Limit terminal repaints so
    // this view cannot starve input handling.
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, 50);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    clearInterval(this.ticker);
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
    return true;
  }

  private close() {
    if (this.cleanup()) this.done(null);
  }

  dispose(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    if (
      this.keybindings.matches(data, "app.interrupt") ||
      this.keybindings.matches(data, "tui.select.cancel")
    ) {
      this.close();
      return;
    }
    if (data === "t") {
      this.stream = this.stream === "stdout" ? "stderr" : "stdout";
      this.lineCache = createOutputLineCache();
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "x") {
      const snap = this.snap();
      if (snap?.status === "running") this.view.requestKill(this.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp") || data === "k") {
      this.scrollOffset += OUTPUT_SCROLL_STEP;
      this.tui.requestRender();
      return;
    }
    if (
      this.keybindings.matches(data, "tui.editor.cursorDown") ||
      data === "j"
    ) {
      this.scrollOffset = Math.max(0, this.scrollOffset - OUTPUT_SCROLL_STEP);
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageUp")) {
      this.scrollOffset += this.viewportHeight();
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageDown")) {
      this.scrollOffset = Math.max(
        0,
        this.scrollOffset - this.viewportHeight(),
      );
      this.tui.requestRender();
      return;
    }
    if (data === "g") {
      this.scrollOffset = Number.MAX_SAFE_INTEGER; // clamped to top in render
      this.tui.requestRender();
      return;
    }
    if (data === "G") {
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
  }

  private viewportHeight(): number {
    const rows = this.tui.terminal.rows || 30;
    // The complete view renders viewport + 8 chrome rows (borders, header,
    // command, tab, hints). rows - 9 makes the overlay ~terminal rows - 1.
    return Math.max(6, rows - 9);
  }

  render(width: number): string[] {
    const theme = this.theme;
    // One accent rule opens and closes the overlay; interior seams stay quiet
    // so the output, not the frame, is what the eye lands on.
    const edge = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
    const seam = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
    const lines: string[] = [];
    const snap = this.snap();

    if (!snap) {
      lines.push(edge);
      lines.push(theme.fg("dim", `${this.id} is no longer tracked`));
      lines.push(edge);
      return lines;
    }

    lines.push(edge);
    const dot = theme.fg("dim", " · ");
    const header = [
      `${statusGlyph(snap, theme)} ` +
        theme.fg("accent", theme.bold(`${snap.id} · ${oneLine(snap.title)}`)),
      statusWord(snap, theme),
      theme.fg("muted", formatElapsed(snap)),
      theme.fg("muted", `pid ${snap.pid ?? "?"}`),
      ...(snap.status !== "running"
        ? [theme.fg("muted", formatExit(snap))]
        : []),
      ...(snap.status === "running" && snap.timeoutAt !== undefined
        ? [
            theme.fg(
              "warning",
              `${formatDuration((snap.timeoutAt - Date.now()) / 1_000)} left`,
            ),
          ]
        : []),
      theme.fg("dim", snap.cwd),
    ]
      .filter(Boolean)
      .join(dot);
    lines.push(truncateToWidth(header, width));
    lines.push(
      truncateToWidth(
        theme.fg("dim", "$ ") + theme.fg("text", oneLine(snap.command)),
        width,
      ),
    );
    lines.push(seam);

    // Stream tab line: which stream is active, both sizes.
    const active = this.stream;
    const viewData = active === "stdout" ? snap.stdout : snap.stderr;
    const tab = (name: "stdout" | "stderr", size: number) =>
      name === active
        ? theme.fg("accent", theme.bold(`${name} (${formatSize(size)})`))
        : theme.fg("dim", `${name} (${formatSize(size)})`);
    lines.push(
      truncateToWidth(
        ` ${tab("stdout", snap.stdout.totalBytes)}${theme.fg("dim", " · ")}${tab("stderr", snap.stderr.totalBytes)}${theme.fg("dim", "   t")} ${theme.fg("dim", "switch")}`,
        width,
      ),
    );

    // Fixed-height output viewport. Notes and scroll status consume rows
    // inside the viewport so streaming/scrolling never changes overlay height.
    const buffer = viewData;
    const version =
      // The cached view text identity changes with the buffer; totalBytes is a
      // monotonically increasing proxy for a version counter.
      buffer.totalBytes;
    const output = this.lineCache.get(buffer.text, version, width - 2);
    const viewport = this.viewportHeight();

    const noteRows: string[] = [];
    if (snap.errorText) {
      noteRows.push(
        truncateToWidth(
          theme.fg("error", `error: ${oneLine(snap.errorText)}`),
          width,
        ),
      );
    }
    if (buffer.truncatedBytes > 0) {
      noteRows.push(
        truncateToWidth(
          theme.fg(
            "dim",
            `first ${formatSize(buffer.truncatedBytes)} dropped from view — full log: ${buffer.spillPath ?? "(unavailable)"}`,
          ),
          width,
        ),
      );
    }

    const body: string[] = [...noteRows];
    const scrollRows = this.scrollOffset > 0 ? 1 : 0;
    const capacity = Math.max(1, viewport - body.length - scrollRows);
    const maxOffset = Math.max(0, output.length - capacity);
    if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

    const end = output.length - this.scrollOffset;
    const visible = output.slice(Math.max(0, end - capacity), end);
    if (visible.length === 0) {
      body.push(theme.fg("dim", `(no ${active} yet)`));
    } else {
      for (const line of visible) {
        body.push(truncateToWidth(`  ${line}`, width));
      }
    }

    if (this.scrollOffset > 0) {
      body.push(
        truncateToWidth(
          theme.fg("dim", `… ${this.scrollOffset} lines below · ↓/pgdn`),
          width,
        ),
      );
    }
    while (body.length < viewport) body.push("");
    lines.push(...body.slice(0, viewport));

    lines.push(seam);
    const keys = (binding: Parameters<KeybindingsManager["getKeys"]>[0]) =>
      configuredKeys(this.keybindings, binding);
    lines.push(
      hintLine(
        theme,
        [
          [keys("tui.select.cancel"), "back"],
          ["t", "stdout/stderr"],
          ["x", "kill"],
          [
            `${keys("tui.editor.cursorUp")}/${keys("tui.editor.cursorDown")}/jk`,
            "scroll",
          ],
          [
            `${keys("tui.editor.pageUp")}/${keys("tui.editor.pageDown")}`,
            "page",
          ],
          ["g/G", "top/bottom"],
        ],
        width,
      ),
    );
    lines.push(edge);
    return lines;
  }

  invalidate(): void {}
}
