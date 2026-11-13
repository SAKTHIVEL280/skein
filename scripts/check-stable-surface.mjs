#!/usr/bin/env node
// Verify that every design token and region Skein promises to skills still
// exists in the Firefox source tree. Run on every upstream merge:
//   node scripts/check-stable-surface.mjs [path-to-engine]
// Exits non-zero (and lists what went missing) if the surface broke.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = path.resolve(process.argv[2] || path.join(root, "engine"));
const mod = p => path.join(root, "skein/browser/components/skein", p);
const { TOKENS, REGIONS, BASE_VERSION } = await import(mod("SkeinSurface.sys.mjs"));
const { PROTECTED_TOKENS, CONTAINER_TOKENS, ALLOWED_PREFS } = await import(mod("SkeinValidator.sys.mjs"));

const SEARCH_DIRS = ["browser/base/content", "browser/components", "browser/themes", "browser/app/profile", "toolkit/themes/shared", "toolkit/content", "toolkit/components/prompts", "modules/libpref/init"];

function found(pattern, fixed = true) {
  try {
    execFileSync("rg", ["-q", ...(fixed ? ["-F"] : []), "-e", pattern, ...SEARCH_DIRS], { cwd: engine, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const missing = [];
const warn = [];

for (const [token, { maps }] of Object.entries(TOKENS)) {
  for (const upstream of maps) {
    if (!found(`${upstream}:`) && !found(`${upstream},`) && !found(`var(${upstream})`)) {
      missing.push(`token ${token} -> ${upstream}`);
    }
  }
}

function selectorExists(selector) {
  const name = selector.slice(1);
  if (name.startsWith("skein-")) {
    return true;
  }
  return selector.startsWith("#") ? found(`id="${name}"`) || found(`"${name}"`) : found(`\\b${name}\\b`, false);
}

for (const region of REGIONS) {
  if (!selectorExists(region.selector)) {
    missing.push(`region ${region.selector}`);
  }
}

// Validator token lists: a stale entry is harmless but worth pruning; these
// are warnings, because several are class names assigned from script.
for (const token of [...PROTECTED_TOKENS, ...CONTAINER_TOKENS]) {
  if (!token.startsWith("skein-") && !found(`\\b${token}\\b`, false)) {
    warn.push(`validator token "${token}" no longer appears in the tree`);
  }
}

for (const pref of Object.keys(ALLOWED_PREFS)) {
  if (!pref.startsWith("skein.") && !found(`"${pref}"`) && !found(`name: ${pref}`)) {
    missing.push(`pref ${pref}`);
  }
}

for (const w of warn) {
  console.warn(`warning: ${w}`);
}
if (missing.length) {
  console.error(`Stable surface check FAILED against ${engine} (surface written for ${BASE_VERSION}):`);
  for (const m of missing) {
    console.error(`  missing: ${m}`);
  }
  process.exit(1);
}
console.log(`Stable surface OK: ${Object.keys(TOKENS).length} tokens, ${REGIONS.length} regions, ${Object.keys(ALLOWED_PREFS).length} prefs.`);
