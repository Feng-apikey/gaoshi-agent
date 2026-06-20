import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { load as _load, save as _save } from "../api/routes/settings.ts";

// Use temp directory for isolated testing
const tmpDir = path.join(os.tmpdir(), `gaoshi_settings_test_${Date.now()}`);
const SETTINGS_FILE = path.join(tmpDir, "config", "settings.json");

// Wrap real functions with test file path (settings.ts supports optional path override)
const load = () => _load(SETTINGS_FILE);
const save = (s: { autoApprove: boolean }) => _save(s, SETTINGS_FILE);

beforeAll(() => {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("settings load/save", () => {
  it("returns default { autoApprove: false } when no file exists", () => {
    // Ensure file doesn't exist
    try { fs.unlinkSync(SETTINGS_FILE); } catch {}
    const settings = load();
    expect(settings.autoApprove).toBe(false);
  });

  it("saves and loads settings round-trip", () => {
    save({ autoApprove: true });
    const settings = load();
    expect(settings.autoApprove).toBe(true);
  });

  it("getAutoApprove returns the saved value", () => {
    save({ autoApprove: true });
    expect(load().autoApprove).toBe(true);

    save({ autoApprove: false });
    expect(load().autoApprove).toBe(false);
  });

  it("partial update preserves existing values", () => {
    save({ autoApprove: true });
    // Simulate PUT: load, merge, save
    const current = load();
    current.autoApprove = false;
    save(current);
    expect(load().autoApprove).toBe(false);
  });

  it("handles corrupted settings file gracefully", () => {
    fs.writeFileSync(SETTINGS_FILE, "{corrupted json!!!", "utf-8");
    const settings = load();
    expect(settings.autoApprove).toBe(false); // fallback default
  });

  it("creates config directory if missing", () => {
    // Remove everything and verify save creates it
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    expect(fs.existsSync(path.dirname(SETTINGS_FILE))).toBe(false);

    save({ autoApprove: true });
    expect(fs.existsSync(SETTINGS_FILE)).toBe(true);
    expect(load().autoApprove).toBe(true);
  });
});
