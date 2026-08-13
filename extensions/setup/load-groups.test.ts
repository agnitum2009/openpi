import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_SETUP_CONFIG,
  EXTENSION_LOAD_GROUPS,
  OPENPI_EXTENSION_GROUPS,
  extensionEntriesForGroup,
  parseSetupConfig,
  syncExtensionManifest,
  type ExtensionLoadGroup,
} from "../shared/setup-config.ts";

test("load groups: all = 24 unique entries; system + setup always loaded", () => {
  const entries = extensionEntriesForGroup("all");
  assert.equal(entries.length, 24);
  assert.equal(new Set(entries).size, 24);
  for (const entry of entries) {
    assert.ok(entry.startsWith("./extensions/"));
    assert.ok(entry.endsWith("/index.ts"));
  }
  for (const name of [
    ...OPENPI_EXTENSION_GROUPS.system,
    ...OPENPI_EXTENSION_GROUPS.setup,
  ]) {
    for (const group of EXTENSION_LOAD_GROUPS) {
      assert.ok(
        extensionEntriesForGroup(group).includes(
          `./extensions/${name}/index.ts`,
        ),
        `${group} must include ${name}`,
      );
    }
  }
});

test("load groups: core-runtime drops utility; core drops utility + runtime", () => {
  const coreRuntime = extensionEntriesForGroup("core-runtime");
  assert.equal(coreRuntime.length, 22);
  for (const name of OPENPI_EXTENSION_GROUPS.utility) {
    assert.ok(!coreRuntime.includes(`./extensions/${name}/index.ts`));
  }

  const core = extensionEntriesForGroup("core");
  assert.equal(core.length, 19);
  for (const name of [
    ...OPENPI_EXTENSION_GROUPS.utility,
    ...OPENPI_EXTENSION_GROUPS.runtime,
  ]) {
    assert.ok(!core.includes(`./extensions/${name}/index.ts`));
  }
});

test("parseSetupConfig defaults a missing or invalid load group to all", () => {
  assert.equal(parseSetupConfig({}).extensions.loadGroup, "all");
  assert.equal(DEFAULT_SETUP_CONFIG.extensions.loadGroup, "all");
  assert.equal(
    parseSetupConfig({ extensions: { loadGroup: "bogus" } }).extensions
      .loadGroup,
    "all",
  );
  assert.equal(
    parseSetupConfig({ extensions: { loadGroup: "core" } }).extensions
      .loadGroup,
    "core",
  );
});

test("syncExtensionManifest rewrites only pi.extensions", () => {
  const dir = mkdtempSync(join(tmpdir(), "openpi-manifest-"));
  const manifestPath = join(dir, "package.json");
  const original = {
    name: "probe-package",
    version: "1.0.0",
    pi: { extensions: ["./extensions"], skills: ["./skills"] },
  };
  writeFileSync(manifestPath, JSON.stringify(original), "utf8");
  try {
    const group: ExtensionLoadGroup = "core-runtime";
    const entries = syncExtensionManifest(group, manifestPath);
    assert.deepEqual(entries, extensionEntriesForGroup(group));
    const stored = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(stored.name, "probe-package");
    assert.equal(stored.version, "1.0.0");
    assert.deepEqual((stored.pi as Record<string, unknown>).skills, [
      "./skills",
    ]);
    assert.deepEqual((stored.pi as Record<string, unknown>).extensions, [
      ...entries,
    ]);
    assert.ok(existsSync(manifestPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
