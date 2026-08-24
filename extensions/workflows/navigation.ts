import { truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import {
  BelowEditorNavigationEditor,
  BelowEditorStripState,
  belowEditorStripInput,
  fitNavigationSides,
  renderNavigationMetrics,
} from "../shared/below-editor-navigation.ts";
import { SPINNER_INTERVAL_MS, spinnerFrame } from "../shared/spinner.ts";
import { sanitizeTerminalText } from "../shared/terminal-text.ts";
import {
  aggregateUsage,
  countStates,
  formatElapsed,
  formatTokens,
  statusColor,
  type Theme,
  type WorkflowDetails,
  type WorkflowStatus,
} from "./model.ts";

/** Workflow-named aliases preserve the public seam while sharing interaction. */
export {
  BelowEditorNavigationEditor as WorkflowNavigationEditor,
  BelowEditorStripState as WorkflowStripState,
  belowEditorStripInput as workflowStripInput,
};

export interface WorkflowStripEntry {
  runId: string;
  details: WorkflowDetails;
}

function cleanLine(value: string) {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

/**
 * One status indicator per run state; doubles as the focus marker when
 * selected. Running spins, in step with the dashboard and takeover headers.
 */
function statusGlyph(status: WorkflowStatus, theme: Theme, now: number) {
  if (status === "completed") return theme.fg("success", "✓");
  if (status === "running") return theme.fg("warning", spinnerFrame(now));
  if (status === "uncertain") return theme.fg("warning", "?");
  return theme.fg("error", "✗");
}

export class WorkflowStripWidget {
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly strip: BelowEditorStripState;
  private readonly getEntry: () => WorkflowStripEntry | undefined;

  constructor(
    tui: TUI,
    theme: Theme,
    strip: BelowEditorStripState,
    getEntry: () => WorkflowStripEntry | undefined,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.strip = strip;
    this.getEntry = getEntry;
    this.timer = setInterval(
      () => this.tui.requestRender(),
      SPINNER_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  dispose() {
    clearInterval(this.timer);
  }

  invalidate() {}

  render(width: number) {
    if (width <= 0) return [];
    const entry = this.getEntry();
    if (!entry) return [];
    const details = entry.details;
    const { done, failed, uncertain } = countStates(details);
    const settled = done + failed;
    const usage = aggregateUsage(details.agents);
    const tokenCount = usage.input + usage.output;
    const lines: string[] = [];

    // Header, same shape as the Subagents HUD — but its right-side metrics
    // render in accent rather than warning, so the two stacked panels never
    // blur into one another at a glance.
    const glyph = this.strip.focused
      ? this.theme.fg("accent", "❯")
      : statusGlyph(details.status, this.theme, Date.now());
    const displayName = cleanLine(details.name ?? entry.runId) || entry.runId;
    const name = this.strip.focused
      ? this.theme.bold(this.theme.fg("accent", displayName))
      : this.theme.fg("text", displayName);
    const rawContext = details.currentPhase ?? details.description;
    const context = rawContext ? cleanLine(rawContext) : undefined;
    const left = ` ${glyph} ${name}${context ? this.theme.fg("dim", ` · ${context}`) : ""}`;
    const right = renderNavigationMetrics(
      this.theme,
      [
        details.agents.length > 0
          ? `${settled}/${details.agents.length} agents${uncertain ? ` · ${uncertain} uncertain` : ""}`
          : undefined,
        formatElapsed(details.startedAt, details.finishedAt),
        tokenCount > 0 ? `${formatTokens(tokenCount)} tokens` : undefined,
      ],
      this.strip.focused ? "enter open · ↑ back" : "↓ to manage",
      details.status === "running" ? undefined : statusColor(details.status),
    );
    lines.push(fitNavigationSides(left, right, width));

    // One row per agent, same `■ label · phase` shape as the Subagents rows.
    const visible = details.agents.slice(0, WORKFLOW_HUD_ROWS);
    const hidden = details.agents.length - visible.length;
    for (const agent of visible) {
      const phase = agent.phase ? ` · ${cleanLine(agent.phase)}` : "";
      const model = agent.model ? ` · ${cleanLine(agent.model)}` : "";
      // AgentState (running/done/error) maps onto WorkflowStatus (running/
      // completed/failed/aborted) for the status square.
      const state: WorkflowStatus =
        agent.state === "done"
          ? "completed"
          : agent.state === "error"
            ? "failed"
            : "running";
      lines.push(
        truncateToWidth(
          `  ${statusGlyph(state, this.theme, Date.now())} ${this.theme.fg("text", cleanLine(agent.label))}${phase}${model}`,
          width,
        ),
      );
    }
    if (hidden > 0) {
      lines.push(
        truncateToWidth(
          this.theme.fg("dim", `  … ${hidden} more agents`),
          width,
        ),
      );
    }
    if (details.status === "failed" || details.status === "aborted") {
      lines.push(
        truncateToWidth(
          this.theme.fg(
            "error",
            `  ✗ ${details.status === "failed" ? "failed" : "aborted"} — enter to inspect`,
          ),
          width,
        ),
      );
    }
    return lines;
  }
}

/** Running-agent rows the workflow HUD shows before collapsing the rest. */
export const WORKFLOW_HUD_ROWS = 4;
