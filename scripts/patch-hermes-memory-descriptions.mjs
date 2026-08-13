#!/usr/bin/env node
/**
 * Patch pi-hermes-memory tool descriptions for token efficiency.
 *
 * pi-hermes-memory loads in-process (pi.extensions -> src/index.ts) and
 * registers 6 tools: memory_add / memory_replace / memory_remove (share
 * MEMORY_TOOL_DESCRIPTION + action lines), memory_search, session_search
 * (anchor + legacy variants), skill_manage (SKILL_TOOL_DESCRIPTION).
 * In-process baseline (runtime loader probe): 9,298 chars of tool
 * descriptions per round.
 *
 * Compressed descriptions KEEP: WHEN triggers, save/no-save contracts,
 * target semantics, required-field contracts, scope semantics + storage
 * paths, name-shadowing contract, structured-field contracts. Only
 * verbosity, example blocks and duplicated explanations are cut.
 * Parameter schemas, promptSnippet and promptGuidelines are NOT touched
 * (schemas + behavioral guidelines are must-keep per adversarial eval).
 *
 * pi update --all reinstalls the package and wipes the patch — re-run this
 * script afterwards (same replay pattern as reapply-kernel-resume-patch).
 * Backups: *.bak-tool-descriptions.
 *
 * Usage: node scripts/patch-hermes-memory-descriptions.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.env.HOME ?? '', '.pi/agent/npm/node_modules/pi-hermes-memory');
const TARGETS = [
  join(ROOT, 'src/constants.ts'),
  join(ROOT, 'src/tools/memory-tool.ts'),
  join(ROOT, 'src/tools/memory-search-tool.ts'),
  join(ROOT, 'src/tools/session-search-tool.ts'),
];

// Compressed descriptions — plain text only: no ${} placeholders, no backticks.
const DESCRIPTIONS = {
  memory_tool_description: [
    "Save durable info to persistent memory that survives across sessions. Searchable in future turns — keep entries compact, focused on facts that still matter.",
    "",
    "WHEN TO SAVE (proactive — don't wait to be asked):",
    "- User corrects you or says 'remember this' / 'don't do that again'",
    "- User shares a preference, habit, or personal detail (name, role, timezone, coding style)",
    "- You discover environment facts (OS, installed tools, project structure)",
    "- You learn a convention, API quirk, or workflow of this setup",
    "- A stable fact will matter in future sessions",
    "",
    "PRIORITY: user preferences and corrections > environment facts > procedural knowledge.",
    "Do NOT save task progress, session outcomes, completed-work logs, or TODO state.",
    "",
    "TARGETS: 'user' — who the user is (name, role, preferences, style); 'memory' — global env facts, tool quirks, lessons; 'project' — architecture decisions, API quirks, team norms; 'failure' — failures, corrections, insights, conventions, preferences, tool quirks.",
    "",
    "TOOLS: memory_add — target + content required (category/failure_reason optional for failure memories); memory_replace — target + old_text + content; memory_remove — target + old_text. Use the matching action tool.",
  ].join("\n"),

  skill_tool_description: [
    "Manage reusable procedures (skills) that survive across sessions — procedural memory for HOW to do something.",
    "",
    "Actions:",
    "- create: new skill. Requires name, description, scope. scope='global' → portable workflows, stored in ~/.pi/agent/pi-hermes-memory/skills/<slug>/SKILL.md, separate from user-installed skills (a name already used in ~/.pi/agent/skills/ is rejected rather than shadowed). scope='project' → repo-specific workflows (paths, scripts, architecture, deploy, conventions), stored in ~/.pi/agent/projects-memory/<project>/skills/<slug>/SKILL.md.",
    "- view: read one skill by skill_id, or list all skills when skill_id is omitted.",
    "- patch: update one section by skill_id + section. Pass section plus the matching structured field.",
    "- update / edit: full rewrite of description + body by skill_id.",
    "- delete: remove by skill_id.",
    "",
    "Prefer structured fields (when_to_use, procedure_steps, pitfalls, verification_steps) over raw markdown. Body sections: When to Use / Procedure / Pitfalls / Verification. For patch, JSON arrays are auto-coerced for list sections; JSON objects are rejected.",
    "",
    "WHEN TO CREATE: after a complex task that required trial and error or multiple tool calls; a non-obvious reusable approach was found; the user teaches a workflow.",
    "WHEN TO UPDATE: 'patch' for one section (better approach, pitfall, or changed step); 'update' for multi-section rewrites.",
    "",
    "Do not use this tool to discover already-loaded external skills by name alone — use Pi's loaded skill context or explicit SKILL.md paths.",
  ].join("\n"),

  memory_search: [
    "Search the extended memory store (unlimited capacity) for relevant entries. Use when you need context beyond the system prompt: specific topics, project conventions, user preferences, or past failures (category='failure').",
    "",
    "Returns matching entries with project context and dates.",
  ].join("\n"),

  session_search_anchors: [
    "Search Pi session JSONL files in the opt-in anchor mode using a Markdown request.",
    "",
    "Scalar fields: from, to, cwd, limit. List sections: all (every term must match), any (at least one term), exclude (remove matching ranges). Returns compact JSONL line-range anchors (path:startLine-endLine with short reason), not summaries or previews.",
    "",
    "Example:",
    "from: 2026-05-14",
    "to: 2026-05-15",
    "cwd: /path/to/project",
    "limit: 20",
    "",
    "all:",
    "- alpha",
  ].join("\n"),

  session_search_legacy: [
    "Search across past Pi coding sessions for relevant conversation context. Use when the user asks about previous discussions, past work, or needs context from earlier sessions.",
    "",
    "Returns bounded conversation snippets with session dates and project context. Large messages are truncated with their original character count.",
  ].join("\n"),
};

// Small exact-text replacements in memory-tool.ts: the common suffix line and
// the three action lines (required-field contracts stay in the shared
// MEMORY_TOOL_DESCRIPTION TOOLS block and in the parameter schemas).
const TEXT_REPLACEMENTS = [
  { file: 'src/tools/memory-tool.ts', label: 'common suffix', from: 'This action-specific tool accepts only the parameters listed in its schema.', to: 'Accepts only the parameters listed in its schema.' },
  { file: 'src/tools/memory-tool.ts', label: 'memory_add action line', from: 'Add one durable entry. The target and content fields are required.', to: 'Add one durable entry.' },
  { file: 'src/tools/memory-tool.ts', label: 'memory_replace action line', from: 'Replace one existing entry. The target, old_text, and content fields are required.', to: 'Replace one existing entry.' },
  { file: 'src/tools/memory-tool.ts', label: 'memory_remove action line', from: 'Remove one existing entry. The target and old_text fields are required.', to: 'Remove one existing entry.' },
];

const check = process.argv.includes('--check');

// New text must be plain: no interpolation, no backticks (template-safety).
function assertPlain(text, label) {
  if (text.includes(String.fromCharCode(36) + '{') || text.includes(String.fromCharCode(96))) {
    throw new Error('NEW description for ' + label + ' contains ${} or a backtick — keep it plain text.');
  }
}

function findStringEnd(source, quote, from, terminator) {
  let i = from;
  for (;;) {
    const end = source.indexOf(quote, i);
    if (end < 0) return undefined;
    if (source[end - 1] !== '\\' && source[end + 1] === terminator) return end;
    i = end + 1;
  }
}

// Capture the value of "export const NAME = <string>;" in constants.ts.
function locateConst(source, name) {
  const re = new RegExp('export const ' + name + '\\s*=\\s*([\\x60\'])');
  const m = re.exec(source);
  if (!m) return undefined;
  const quote = m[1];
  const start = m.index + m[0].length;
  const end = findStringEnd(source, quote, start, ';');
  if (end === undefined) return undefined;
  return { start, end, quote };
}

// Capture the description of the n-th pi.registerTool({...}) block.
function locateRegisterToolDescription(source, occurrence) {
  const blockRe = /pi\.registerTool\(\{/;
  let from = 0;
  let blockAt = -1;
  for (let n = 0; n <= occurrence; n++) {
    const rel = source.slice(from).search(blockRe);
    if (rel < 0) return undefined;
    blockAt = from + rel;
    from = blockAt + 1;
  }
  const d = /description:\s*([\x60'])/.exec(source.slice(blockAt));
  if (!d) return undefined;
  const quote = d[1];
  const start = blockAt + d.index + d[0].length;
  const end = findStringEnd(source, quote, start, ',');
  if (end === undefined) return undefined;
  return { start, end, quote };
}

// Capture the memory_search description in memory-search-tool.ts.
function locateMemorySearch(source) {
  const re = /name:\s*'memory_search'/;
  const m = re.exec(source);
  if (!m) return undefined;
  const d = /description:\s*([\x60'])/.exec(source.slice(m.index));
  if (!d) return undefined;
  const quote = d[1];
  const start = m.index + d.index + d[0].length;
  const end = findStringEnd(source, quote, start, ',');
  if (end === undefined) return undefined;
  return { start, end, quote };
}

function renderDescription(text, quote) {
  if (quote === "'") {
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }
  return text; // template literal: plain text, backticks already rejected
}

function collectAnchors(target) {
  const basename = target.split('/').pop();
  if (basename === 'constants.ts') {
    return [
      { label: 'MEMORY_TOOL_DESCRIPTION', locate: (s) => locateConst(s, 'MEMORY_TOOL_DESCRIPTION'), text: DESCRIPTIONS.memory_tool_description },
      { label: 'SKILL_TOOL_DESCRIPTION', locate: (s) => locateConst(s, 'SKILL_TOOL_DESCRIPTION'), text: DESCRIPTIONS.skill_tool_description },
    ];
  }
  if (basename === 'memory-search-tool.ts') {
    return [{ label: 'memory_search', locate: locateMemorySearch, text: DESCRIPTIONS.memory_search }];
  }
  if (basename === 'session-search-tool.ts') {
    return [
      { label: 'session_search (anchors)', locate: (s) => locateRegisterToolDescription(s, 0), text: DESCRIPTIONS.session_search_anchors },
      { label: 'session_search (legacy)', locate: (s) => locateRegisterToolDescription(s, 1), text: DESCRIPTIONS.session_search_legacy },
    ];
  }
  return [];
}

try {
  for (const [label, text] of Object.entries(DESCRIPTIONS)) assertPlain(text, label);
  for (const r of TEXT_REPLACEMENTS) assertPlain(r.to, r.label);

  let allApplied = true;
  let anyLocated = false;
  let changed = false;

  for (const target of TARGETS) {
    if (!existsSync(target)) {
      console.error('Missing target file: ' + target);
      allApplied = false;
      continue;
    }
    const source = readFileSync(target, 'utf8');
    const basename = target.split('/').pop();

    // Text replacements (memory-tool.ts only).
    const repStates = TEXT_REPLACEMENTS
      .filter((r) => r.file === 'src/tools/' + basename)
      .map((r) => ({ ...r, applied: source.includes(r.to) }));
    for (const r of repStates) if (!r.applied) allApplied = false;
    const missingRep = repStates.find((r) => !r.applied && !source.includes(r.from));
    if (missingRep) {
      console.error('[!] ' + missingRep.label + ': OLD text not found in ' + basename + ' — layout changed; re-derive manually.');
      allApplied = false;
      continue;
    }

    // Template-block anchors.
    const anchors = collectAnchors(target);
    const located = anchors.map((a) => ({ ...a, found: a.locate(source) }));
    const allFound = located.every((l) => l.found !== undefined);
    anyLocated = true;
    const blocksApplied = allFound && located.every((l) =>
      source.slice(l.found.start, l.found.end) === renderDescription(l.text, l.found.quote));
    if (!blocksApplied) allApplied = false;
    if (blocksApplied && repStates.every((r) => r.applied)) continue;

    const backupPath = target + '.bak-tool-descriptions';
    if (!existsSync(backupPath)) writeFileSync(backupPath, source, 'utf8');

    let next = source;
    for (const r of repStates) {
      if (r.applied) continue;
      next = next.replace(r.from, r.to);
      console.log('  [' + basename + '] ' + r.label.padEnd(26) + ' ' + String(r.from.length).padStart(5) + ' -> ' + String(r.to.length).padStart(5) + ' chars (-' + (r.from.length - r.to.length) + ', -' + Math.round(((r.from.length - r.to.length) / r.from.length) * 100) + '%)');
    }
    const edits = located.filter((l) => l.found).sort((a, b) => b.found.start - a.found.start);
    for (const { label, found, text } of edits) {
      const before = found.end - found.start;
      const after = text.length;
      next = next.slice(0, found.start) + renderDescription(text, found.quote) + next.slice(found.end);
      console.log('  [' + basename + '] ' + label.padEnd(26) + ' ' + String(before).padStart(5) + ' -> ' + String(after).padStart(5) + ' chars (-' + (before - after) + ', -' + Math.round(((before - after) / before) * 100) + '%)');
    }
    writeFileSync(target, next, 'utf8');
    changed = true;
  }

  if (!anyLocated) {
    console.error('No pi-hermes-memory target files found — check the extension install path.');
    process.exit(1);
  }
  if (check) {
    if (allApplied) { console.log('Patch already applied ✓'); process.exit(0); }
    console.error('Patch NOT applied — run: node scripts/patch-hermes-memory-descriptions.mjs');
    process.exit(1);
  }
  if (!allApplied && !changed) {
    console.error('Some description blocks were not located — the extension layout changed; re-derive manually.');
    process.exit(1);
  }
  console.log('pi-hermes-memory descriptions patched ✓ (backups: *.bak-tool-descriptions)');
} catch (error) {
  console.error('Failed: ' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
