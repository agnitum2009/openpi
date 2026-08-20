/**
 * Takeover UI for subagents (ported from v1, rendering from the synchronous
 * SubagentReadModel instead of live pi sessions):
 * - SubagentDashboard: full popup (overlay) listing all subagents.
 * - TakeoverView: full interactive view of one subagent with an input line
 *   to steer/continue it.
 */

import type {
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Input, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "../../../shared/terminal-text.ts";
import { formatElapsed, type SubagentSnapshot } from "../domain.ts";
import { formatContextUtilization } from "../format.ts";
import type { SubagentReadModel } from "../manager.ts";
import {
  SPINNER_INTERVAL_MS,
  TranscriptRenderer,
  buildTranscriptLines,
  spinnerFrame,
} from "./transcript.ts";

export function sanitizeSubagentDisplayLine(value: string) {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

/**
 * One spinner definition for the whole subagent UI: the dashboard glyph, the
 * takeover header, and the transcript's live tools must animate in step, so the
 * frames and their cadence live in `transcript.ts` and are imported here.
 */
function statusGlyph(
  snap: SubagentSnapshot,
  theme: Theme,
  now = Date.now(),
): string {
  switch (snap.status) {
    case "running":
      return theme.fg("warning", spinnerFrame(now));
    case "done":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
  }
}

function runningActivity(snap: SubagentSnapshot) {
  if (snap.status !== "running") return "";
  const liveTool = snap.liveTools.at(-1);
  if (liveTool) {
    const args = truncateToWidth(
      sanitizeSubagentDisplayLine(liveTool.argsPreview ?? ""),
      48,
    );
    return args ? `${liveTool.name} · ${args}` : liveTool.name;
  }
  for (const item of [...snap.transcript].reverse()) {
    if (item.kind === "toolResult") return item.name;
    if (item.kind !== "assistant") continue;
    const tool = [...item.parts]
      .reverse()
      .find((part) => part.type === "toolCall");
    if (tool?.type === "toolCall") return tool.name;
  }
  return "";
}

// --- Entry points --------------------------------------------------------------

export interface TakeoverOptions {
  readonly badge?: string;
}

export async function openSubagentTakeover(
  ctx: ExtensionContext,
  view: SubagentReadModel,
  id: string,
  options?: TakeoverOptions,
) {
  if (!view.get(id)) return;
  await ctx.ui.custom<null>(
    (tui, theme, keybindings, done) =>
      new TakeoverView(tui, theme, keybindings, id, view, done, options),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}

export async function openSubagentPicker(
  ctx: ExtensionContext,
  view: SubagentReadModel,
  initialId?: string,
) {
  const selection: DashboardSelection = { id: initialId, index: 0 };

  while (true) {
    if (view.size() === 0) {
      ctx.ui.notify("No subagents", "info");
      return;
    }

    const picked = await ctx.ui.custom<string | null>(
      (tui, theme, keybindings, done) =>
        new SubagentDashboard(tui, theme, keybindings, view, selection, done),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
      },
    );

    if (!picked) return;
    if (!view.get(picked)) continue;

    await openSubagentTakeover(ctx, view, picked);
    // After leaving the takeover view, fall back to the dashboard.
  }
}

// --- Dashboard (fullscreen overlay) ----------------------------------------------

export interface DashboardSelection {
  id?: string;
  index: number;
}

export function reconcileDashboardSelection(
  selection: DashboardSelection,
  subs: ReadonlyArray<Pick<SubagentSnapshot, "id">>,
) {
  const stableIndex = selection.id
    ? subs.findIndex((snap) => snap.id === selection.id)
    : -1;
  selection.index =
    stableIndex >= 0
      ? stableIndex
      : Math.min(Math.max(0, selection.index), Math.max(0, subs.length - 1));
  selection.id = subs[selection.index]?.id;
}

export class SubagentDashboard implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private view: SubagentReadModel;
  private selection: DashboardSelection;
  private done: (value: string | null) => void;

  private closed = false;
  private ticker?: ReturnType<typeof setInterval>;
  private unsubChange: () => void;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    view: SubagentReadModel,
    selection: DashboardSelection,
    done: (value: string | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.view = view;
    this.selection = selection;
    this.done = done;
    this.refreshTicker();
    this.unsubChange = view.subscribe(() => {
      this.refreshTicker();
      this.tui.requestRender();
    });
  }

  private subs(): ReadonlyArray<SubagentSnapshot> {
    return this.view.list();
  }

  private refreshTicker() {
    const interval = this.subs().some((snap) => snap.status === "running")
      ? SPINNER_INTERVAL_MS
      : 1000;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tui.requestRender(), interval);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    if (this.ticker) clearInterval(this.ticker);
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
    const subs = this.subs();
    reconcileDashboardSelection(this.selection, subs);

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.close(null);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const snap = subs[this.selection.index];
      if (snap) this.close(snap.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      if (subs.length > 0) {
        this.selection.index =
          (this.selection.index - 1 + subs.length) % subs.length;
        this.selection.id = subs[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      if (subs.length > 0) {
        this.selection.index = (this.selection.index + 1) % subs.length;
        this.selection.id = subs[this.selection.index]?.id;
        this.tui.requestRender();
      }
      return;
    }
    if (data === "x") {
      const snap = subs[this.selection.index];
      if (snap && snap.status === "running") this.view.requestAbort(snap.id);
      return;
    }
  }

  private pad(text: string, width: number): string {
    const truncated = truncateToWidth(text, width);
    return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
  }

  private borderSegment(width: number, title: string): string {
    const theme = this.theme;
    const label = title
      ? ` ${truncateToWidth(title, Math.max(0, width - 3))} `
      : "";
    const labelWidth = visibleWidth(label);
    return (
      theme.fg("border", "─") +
      (label ? theme.fg("text", label) : "") +
      theme.fg("border", "─".repeat(Math.max(0, width - 1 - labelWidth)))
    );
  }

  render(width: number): string[] {
    const theme = this.theme;
    const subs = this.subs();
    reconcileDashboardSelection(this.selection, subs);

    const rows = this.tui.terminal.rows || 30;
    const maxBodyHeight = Math.max(1, rows - 5);
    const bodyHeight =
      subs.length > maxBodyHeight ? maxBodyHeight : Math.max(1, subs.length);
    const innerWidth = Math.max(0, width - 2);

    const lines: string[] = [];
    const running = subs.filter((snap) => snap.status === "running").length;
    const done = subs.filter((snap) => snap.status === "done").length;
    const failed = subs.filter((snap) => snap.status === "error").length;
    const summary =
      [
        running > 0 ? `${running} running` : "",
        done > 0 ? `${done} done` : "",
        failed > 0 ? `${failed} failed` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "no agents";
    lines.push(
      theme.fg("border", "╭") +
        this.borderSegment(innerWidth, `Subagents · ${summary}`) +
        theme.fg("border", "╮"),
    );

    const divider = theme.fg("border", "│");
    const rowLines = this.renderRows(subs, innerWidth, bodyHeight);
    for (const row of rowLines) {
      lines.push(divider + this.pad(row, innerWidth) + divider);
    }

    // Bottom border
    lines.push(
      theme.fg("border", "╰") +
        theme.fg("border", "─".repeat(innerWidth)) +
        theme.fg("border", "╯"),
    );

    // Hints
    lines.push(
      truncateToWidth(
        theme.fg(
          "dim",
          `  ${configuredKeys(this.keybindings, "tui.select.up")}/${configuredKeys(this.keybindings, "tui.select.down")}/jk select · ${configuredKeys(this.keybindings, "tui.select.confirm")} take over · x abort · ${configuredKeys(this.keybindings, "tui.select.cancel")} close`,
        ),
        width,
      ),
    );

    return lines;
  }

  private renderRows(
    subs: ReadonlyArray<SubagentSnapshot>,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const out: string[] = [];

    const needsMore = subs.length > height && height > 1;
    const visibleHeight = needsMore ? height - 1 : height;

    // Scroll window around selection. The more indicator gets its own row, so
    // it never replaces a selectable subagent.
    let start = 0;
    if (subs.length > visibleHeight) {
      start = Math.min(
        Math.max(0, this.selection.index - Math.floor(visibleHeight / 2)),
        Math.max(0, subs.length - visibleHeight),
      );
    }
    const visible = subs.slice(start, start + visibleHeight);

    for (let i = 0; i < visible.length; i++) {
      const snap = visible[i];
      const index = start + i;
      const isSelected = index === this.selection.index;

      const marker = isSelected ? theme.fg("accent", "❯") : " ";
      const safeTitle = sanitizeSubagentDisplayLine(snap.title) || snap.id;
      const title = isSelected
        ? theme.fg("accent", safeTitle)
        : theme.fg("text", safeTitle);
      const activity = runningActivity(snap);
      const prefix = ` ${marker} ${statusGlyph(snap, theme)} `;

      const utilization = formatContextUtilization(snap.usage);
      const metadata = [
        theme.fg("muted", snap.backend),
        theme.fg(
          "muted",
          sanitizeSubagentDisplayLine(snap.meta.modelLabel ?? "?") || "?",
        ),
        ...(utilization ? [theme.fg("muted", utilization)] : []),
        theme.fg("muted", formatElapsed(snap)),
      ];
      const dot = theme.fg("dim", " · ");
      // Preserve elapsed and the activity-bearing left side longest. Shed the
      // least useful metadata as a segment instead of clipping a joined tail.
      while (
        metadata.length > 1 &&
        visibleWidth(metadata.join(dot)) > Math.max(0, width - 16)
      ) {
        metadata.shift();
      }
      const right = metadata.join(dot);
      const rightWidth = visibleWidth(right);
      const leftMax = Math.max(0, width - rightWidth - (right ? 2 : 0));
      const activityLabel = activity ? theme.fg("muted", ` · ${activity}`) : "";
      const left =
        prefix +
        truncateToWidth(
          title,
          Math.max(
            0,
            leftMax - visibleWidth(prefix) - visibleWidth(activityLabel),
          ),
        ) +
        truncateToWidth(
          activityLabel,
          Math.max(0, leftMax - visibleWidth(prefix)),
        );
      const gap = right
        ? Math.max(1, width - visibleWidth(left) - rightWidth)
        : 0;
      out.push(truncateToWidth(left + " ".repeat(gap) + right, width));
    }

    if (needsMore) {
      out.push(
        truncateToWidth(
          theme.fg("dim", `   … ${subs.length - visible.length} more`),
          width,
        ),
      );
    }
    return out;
  }

  invalidate(): void {}
}

// --- Takeover view ------------------------------------------------------------

const TRANSCRIPT_SCROLL_STEP = 6;

export class TakeoverView implements Component, Focusable {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private id: string;
  private view: SubagentReadModel;
  private done: (value: null) => void;
  private options?: TakeoverOptions;

  private input = new Input();
  private transcriptRenderer = new TranscriptRenderer();
  /** Scroll offset in lines from the bottom of the transcript. 0 = pinned to bottom. */
  private scrollOffset = 0;
  private unsubscribe: () => void;
  private renderTimer?: ReturnType<typeof setTimeout>;
  private ticker?: ReturnType<typeof setInterval>;
  private closed = false;

  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    id: string,
    view: SubagentReadModel,
    done: (value: null) => void,
    options?: TakeoverOptions,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.id = id;
    this.view = view;
    this.done = done;
    this.options = options;
    this.unsubscribe = view.subscribeTo(id, () => {
      this.refreshTicker();
      this.scheduleRender();
    });
    this.refreshTicker();
    this.input.onSubmit = (value: string) => {
      const text = value.trim();
      if (!text) return;
      this.input.setValue("");
      this.view.requestSend(this.id, text);
      this.scrollOffset = 0;
      this.tui.requestRender();
    };
  }

  private snap(): SubagentSnapshot | undefined {
    return this.view.get(this.id);
  }

  private refreshTicker() {
    const interval =
      this.snap()?.status === "running" ? SPINNER_INTERVAL_MS : 1000;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tui.requestRender(), interval);
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    // Streaming can emit an event per token. Limit terminal repaints so this
    // view cannot starve input handling or make the child look frozen.
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, 50);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    if (this.ticker) clearInterval(this.ticker);
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
    if (this.keybindings.matches(data, "app.clear")) {
      const snap = this.snap();
      if (snap?.status === "running") this.view.requestAbort(this.id);
      return;
    }
    if (
      this.keybindings.matches(data, "app.interrupt") ||
      this.keybindings.matches(data, "tui.select.cancel")
    ) {
      this.close();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp")) {
      this.scrollOffset += TRANSCRIPT_SCROLL_STEP;
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorDown")) {
      this.scrollOffset = Math.max(
        0,
        this.scrollOffset - TRANSCRIPT_SCROLL_STEP,
      );
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
    this.input.handleInput(data);
    this.tui.requestRender();
  }

  private viewportHeight(): number {
    const rows = this.tui.terminal.rows || 30;
    // Top rule, transcript rule, input, key hints, and bottom rule are five
    // chrome rows. The overlay leaves Pi's final footer row visible.
    return Math.max(1, rows - 6);
  }

  private rule(width: number, left = "", right = "") {
    const fill = "─";
    const available = Math.max(1, width);
    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);
    if (!right || leftWidth + rightWidth + 2 > available) {
      return truncateToWidth(
        left + fill.repeat(Math.max(0, available - leftWidth)),
        available,
      );
    }
    return (
      left +
      fill.repeat(Math.max(1, available - leftWidth - rightWidth)) +
      right
    );
  }

  render(width: number): string[] {
    const theme = this.theme;
    const now = Date.now();
    const lines: string[] = [];
    const snap = this.snap();

    if (!snap) {
      const border = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
      lines.push(
        border,
        theme.fg("dim", `${this.id} is no longer tracked`),
        border,
      );
      return lines;
    }

    const title = sanitizeSubagentDisplayLine(snap.title) || snap.id;
    const headerLeft =
      theme.fg("borderAccent", "─ ") +
      statusGlyph(snap, theme, now) +
      " " +
      theme.fg("accent", theme.bold(title)) +
      theme.fg("borderAccent", " ");
    const utilization = formatContextUtilization(snap.usage);
    const metadata = [
      ...(this.options?.badge
        ? [theme.fg("muted", sanitizeSubagentDisplayLine(this.options.badge))]
        : []),
      theme.fg(
        "muted",
        sanitizeSubagentDisplayLine(snap.meta.modelLabel ?? "?") || "?",
      ),
      ...(utilization ? [theme.fg("muted", utilization)] : []),
      theme.fg("muted", formatElapsed(snap)),
    ];
    const dot = theme.fg("dim", " · ");
    while (
      metadata.length > 1 &&
      visibleWidth(headerLeft) + visibleWidth(metadata.join(dot)) + 2 > width
    ) {
      metadata.shift();
    }
    lines.push(
      this.rule(
        width,
        truncateToWidth(
          headerLeft,
          Math.max(1, width - visibleWidth(metadata.join(dot)) - 2),
        ),
        metadata.join(dot),
      ),
    );

    // Fixed-height transcript viewport. Errors consume a row, but scroll state
    // is represented by the following rule so its height never changes.
    // `now` is shared with the header glyph so both spinners show one frame.
    const transcript = buildTranscriptLines(
      snap,
      width,
      theme,
      this.transcriptRenderer,
      { now },
    );
    const viewport = this.viewportHeight();
    const errorRows = snap.errorText ? 1 : 0;
    const transcriptCapacity = Math.max(1, viewport - errorRows);
    const maxOffset = Math.max(0, transcript.length - transcriptCapacity);
    if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

    const body: string[] = [];
    if (snap.errorText) {
      body.push(
        truncateToWidth(
          theme.fg(
            "error",
            `error: ${sanitizeSubagentDisplayLine(snap.errorText)}`,
          ),
          width,
        ),
      );
    }
    const end = transcript.length - this.scrollOffset;
    const visible = transcript.slice(
      Math.max(0, end - Math.max(1, viewport - body.length)),
      end,
    );
    if (visible.length === 0) body.push(theme.fg("dim", "waiting for output…"));
    else body.push(...visible);
    while (body.length < viewport) body.push("");
    lines.push(...body.slice(0, viewport));

    lines.push(
      this.rule(
        width,
        theme.fg("borderAccent", "─"),
        this.scrollOffset > 0 ? theme.fg("dim", `↓ ${this.scrollOffset}`) : "",
      ),
    );
    lines.push(...this.input.render(width));
    const hints = `${configuredKeys(this.keybindings, "tui.input.submit")} send · ${configuredKeys(this.keybindings, "app.interrupt")} back · ${configuredKeys(this.keybindings, "app.clear")} abort run · ${configuredKeys(this.keybindings, "tui.editor.cursorUp")}/${configuredKeys(this.keybindings, "tui.editor.cursorDown")} scroll · ${configuredKeys(this.keybindings, "tui.editor.pageUp")}/${configuredKeys(this.keybindings, "tui.editor.pageDown")} page`;
    const compactHints = `${configuredKeys(this.keybindings, "tui.input.submit")} send · ${configuredKeys(this.keybindings, "app.interrupt")} back · ${configuredKeys(this.keybindings, "app.clear")} abort run · ${configuredKeys(this.keybindings, "tui.editor.cursorUp")}/${configuredKeys(this.keybindings, "tui.editor.cursorDown")} scroll`;
    lines.push(
      truncateToWidth(
        theme.fg("dim", visibleWidth(hints) <= width ? hints : compactHints),
        width,
      ),
    );
    lines.push(this.rule(width, theme.fg("borderAccent", "─")));
    return lines;
  }

  invalidate(): void {
    this.input.invalidate();
    this.transcriptRenderer.invalidate();
  }
}
