/**
 * Transcript rendering for the takeover view: turns a SubagentSnapshot's
 * normalized transcript + live state into width-bounded TUI lines. The domain
 * stream stays normalized and bounded; this renderer only formats its previews.
 */

import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type DefaultTextStyle,
  type MarkdownOptions,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "../../../shared/terminal-text.ts";
import type { SubagentSnapshot, TranscriptItem } from "../domain.ts";

const MAX_CACHED_WIDTHS_PER_ITEM = 2;

export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

/** Frame cadence, shared with the dashboard and takeover headers. */
export const SPINNER_INTERVAL_MS = 120;

export function spinnerFrame(now: number) {
  const frame = Math.floor(now / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[
    (frame + SPINNER_FRAMES.length) % SPINNER_FRAMES.length
  ];
}

/**
 * Strip raw ANSI codes, expand tabs, and drop control chars. Terminal-expanded
 * tabs (and stray escapes) make lines wider than the width we declare to the
 * TUI, which desyncs the renderer and smears the overlay.
 */
export function sanitizeText(text: string): string {
  return sanitizeTerminalText(text);
}

function singleLinePreview(text: string) {
  // Keep meaningful whitespace inside parsed commands and paths; only fold
  // physical line breaks so a preview remains one terminal row.
  return sanitizeText(text).replace(/\r?\n/g, " ↵ ");
}

function compactPreview(text: string) {
  return singleLinePreview(text).trim();
}

function stringField(value: Record<string, unknown>, field: string) {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.length > 0
    ? singleLinePreview(candidate)
    : undefined;
}

function parsedArgs(preview: string) {
  try {
    const value: unknown = JSON.parse(preview);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Turn common tool arguments into a useful, bounded summary without retaining raw args. */
export function summarizeToolArgs(name: string, argsPreview?: string) {
  if (!argsPreview) return undefined;

  const fallback = compactPreview(argsPreview);
  if (!fallback || fallback === "{}") return undefined;

  const args = parsedArgs(fallback);
  if (!args) return fallback;

  const tool = name.toLowerCase();
  if (tool === "bash") return stringField(args, "command") ?? fallback;
  if (tool === "read" || tool === "write" || tool === "edit") {
    return stringField(args, "path") ?? fallback;
  }
  if (tool === "rg" || tool === "fd") {
    const pattern = stringField(args, "pattern");
    const path = stringField(args, "path");
    if (pattern && path) return `${pattern} · ${path}`;
    return pattern ?? path ?? fallback;
  }
  return fallback;
}

function transcriptMarkdownTheme() {
  const theme = getMarkdownTheme();
  return {
    ...theme,
    // Markdown normalizes unordered lists to "- "; use a display bullet so
    // transcript list syntax is never confused with unrendered source.
    listBullet: (text: string) =>
      theme.listBullet(text.replace(/^(?:[-+*]) /, "• ")),
  };
}

function renderMarkdown(
  text: string,
  width: number,
  defaultTextStyle?: DefaultTextStyle,
  options?: MarkdownOptions,
) {
  const clean = sanitizeText(text).trim();
  if (!clean) return [];
  const markdown = new Markdown(
    clean,
    0,
    0,
    transcriptMarkdownTheme(),
    defaultTextStyle,
    options,
  );
  return markdown
    .render(Math.max(1, width))
    .map((line) => truncateToWidth(line, width));
}

function renderUserText(theme: Theme, text: string, width: number) {
  const lines = renderMarkdown(
    text,
    Math.max(1, width - 2),
    { color: (content: string) => theme.fg("userMessageText", content) },
    { preserveOrderedListMarkers: true, preserveBackslashEscapes: true },
  );
  return lines.map((line, index) =>
    truncateToWidth(
      (index === 0 ? theme.fg("accent", "> ") : "  ") + line,
      width,
    ),
  );
}

function renderThinking(theme: Theme, text: string, width: number) {
  const reasoning = sanitizeText(text).trim();
  if (!reasoning) return [];
  const out: string[] = [];
  const prefix = theme.fg("dim", "~ ");
  const defaultTextStyle = {
    color: (content: string) => theme.fg("muted", content),
    italic: true,
  } satisfies DefaultTextStyle;
  const lines = renderMarkdown(
    reasoning,
    Math.max(1, width - 2),
    defaultTextStyle,
  );
  for (let i = 0; i < lines.length; i++) {
    out.push(truncateToWidth((i === 0 ? prefix : "  ") + lines[i], width));
  }
  return out;
}

function renderToolBody(theme: Theme, name: string, argsPreview?: string) {
  const toolName = sanitizeText(name);
  const preview = summarizeToolArgs(toolName, argsPreview);
  if (toolName === "bash") return theme.fg("dim", `$ ${preview ?? ""}`);
  return (
    theme.fg("dim", "→ ") +
    theme.fg("toolTitle", toolName) +
    (preview ? theme.fg("dim", ` ${preview}`) : "")
  );
}

function firstOutputPreview(outputPreview?: string) {
  return (
    sanitizeText(outputPreview ?? "")
      .split("\n")
      .find((line) => line.trim()) ?? ""
  );
}

/**
 * `settled: false` marks partial output from a tool that is still running: a
 * success glyph there would claim an outcome the tool has not reached yet.
 */
function renderResultLine(
  theme: Theme,
  isError: boolean,
  outputPreview: string,
  width: number,
  settled = true,
) {
  const glyph = isError
    ? theme.fg("error", "✗")
    : settled
      ? theme.fg("success", "✓")
      : theme.fg("dim", "·");
  const preview = outputPreview || "(no output)";
  const content = isError
    ? theme.fg(outputPreview ? "error" : "dim", preview)
    : theme.fg("dim", preview);
  return truncateToWidth(`  ${glyph} ${content}`, width);
}

function renderAssistantItem(
  theme: Theme,
  item: Extract<TranscriptItem, { kind: "assistant" }>,
  width: number,
) {
  const out: string[] = [];
  for (const part of item.parts) {
    if (part.type === "text") {
      out.push(...renderMarkdown(part.text, width));
    } else if (part.type === "thinking") {
      out.push(
        ...renderThinking(
          theme,
          part.redacted ? "[redacted reasoning]" : part.text,
          width,
        ),
      );
    } else if (part.type === "toolCall") {
      out.push(
        truncateToWidth(
          renderToolBody(theme, part.name, part.argsPreview),
          width,
        ),
      );
    }
  }
  return out;
}

function renderToolResultItem(
  theme: Theme,
  item: Extract<TranscriptItem, { kind: "toolResult" }>,
  width: number,
) {
  return [
    renderResultLine(
      theme,
      item.isError,
      firstOutputPreview(item.outputPreview),
      width,
    ),
  ];
}

function isPairedToolResult(
  previous: TranscriptItem | undefined,
  current: TranscriptItem,
) {
  if (
    !previous ||
    previous.kind !== "assistant" ||
    current.kind !== "toolResult"
  ) {
    return false;
  }
  const lastPart = previous.parts[previous.parts.length - 1];
  return lastPart?.type === "toolCall" && lastPart.toolId === current.toolId;
}

function renderTranscriptItem(
  theme: Theme,
  item: TranscriptItem,
  width: number,
) {
  if (item.kind === "user") return renderUserText(theme, item.text, width);
  if (item.kind === "assistant") return renderAssistantItem(theme, item, width);
  return renderToolResultItem(theme, item, width);
}

/**
 * Caches finalized transcript items by identity and width. Live state remains
 * uncached because it changes on every stream tick; callers clear this cache
 * from their component's invalidate() when Pi changes theme.
 */
export class TranscriptRenderer {
  private itemCache = new WeakMap<TranscriptItem, Map<number, string[]>>();

  render(
    snap: SubagentSnapshot,
    width: number,
    theme: Theme,
    options?: { readonly now?: number },
  ) {
    const out: string[] = [];
    const now = options?.now ?? Date.now();

    for (let index = 0; index < snap.transcript.length; index++) {
      const item = snap.transcript[index];
      const cached = this.itemCache.get(item)?.get(width);
      const lines = cached ?? renderTranscriptItem(theme, item, width);
      if (!cached) {
        const widths = this.itemCache.get(item) ?? new Map<number, string[]>();
        if (widths.size >= MAX_CACHED_WIDTHS_PER_ITEM) {
          const oldestWidth = widths.keys().next().value;
          if (oldestWidth !== undefined) widths.delete(oldestWidth);
        }
        widths.set(width, lines);
        this.itemCache.set(item, widths);
      }
      if (lines.length > 0) {
        if (
          out.length > 0 &&
          !isPairedToolResult(snap.transcript[index - 1], item)
        ) {
          out.push("");
        }
        out.push(...lines);
      }
    }
    while (out.length > 0 && out[out.length - 1] === "") out.pop();

    // Live streaming assistant buffers (cleared when the finalized message lands).
    if (snap.liveAssistant) {
      const { thinking, text } = snap.liveAssistant;
      const before = out.length;
      if (out.length > 0) out.push("");
      if (thinking.trim()) out.push(...renderThinking(theme, thinking, width));
      if (text.trim()) out.push(...renderMarkdown(text, width));
      if (out.length === before + 1) out.pop();
    }

    // Live tool executions (present until the ToolEnd lands in the transcript).
    for (const tool of snap.liveTools) {
      if (out.length > 0) out.push("");
      const marker = tool.done
        ? tool.isError
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓")
        : theme.fg("warning", spinnerFrame(now));
      out.push(
        truncateToWidth(
          `${marker} ${renderToolBody(theme, tool.name, tool.argsPreview)}`,
          width,
        ),
      );
      const preview = firstOutputPreview(tool.outputPreview);
      if (preview)
        out.push(
          renderResultLine(theme, !!tool.isError, preview, width, !!tool.done),
        );
    }

    // Queued steering/follow-up messages: show them immediately so Enter
    // visibly acknowledges the user's input instead of appearing to do nothing.
    for (const message of snap.queued) {
      if (out.length > 0) out.push("");
      const prefix = theme.fg("warning", `> [queued ${message.kind}] `);
      const wrapped = wrapTextWithAnsi(
        sanitizeText(message.text),
        Math.max(1, width - visibleWidth(prefix)),
      );
      for (let i = 0; i < wrapped.length; i++) {
        out.push(
          truncateToWidth(
            (i === 0 ? prefix : " ".repeat(visibleWidth(prefix))) +
              theme.fg("muted", wrapped[i]),
            width,
          ),
        );
      }
    }

    return out;
  }

  invalidate() {
    this.itemCache = new WeakMap();
  }
}

/** Render a subagent's conversation as width-bounded lines. */
export function buildTranscriptLines(
  snap: SubagentSnapshot,
  width: number,
  theme: Theme,
  renderer?: TranscriptRenderer,
  options?: { readonly now?: number },
) {
  return (renderer ?? new TranscriptRenderer()).render(
    snap,
    width,
    theme,
    options,
  );
}
