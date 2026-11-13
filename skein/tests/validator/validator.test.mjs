/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

// Adversarial test suite for the customization validator.
// Run: node --test skein/tests/validator/

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCss,
  validateBundle,
  validatePrefs,
  validateLayout,
  validateKeybindings,
  classifySelector,
} from "../../browser/components/skein/SkeinValidator.sys.mjs";

const ok = css => assert.equal(validateCss(css).ok, true, `expected OK: ${css}\n${JSON.stringify(validateCss(css).errors)}`);
const bad = (css, code) => {
  const res = validateCss(css);
  assert.equal(res.ok, false, `expected rejection: ${css}`);
  if (code) {
    assert.ok(res.errors.some(e => e.code === code), `expected ${code}, got ${JSON.stringify(res.errors)}`);
  }
};

test("accepts ordinary theme CSS", () => {
  ok(`:root { --skein-accent: #7c5cff; --my-gap: 4px; }`);
  ok(`#TabsToolbar { background-color: #101018; padding: 4px; }`);
  ok(`.tabbrowser-tab[selected] .tab-background { background: linear-gradient(#333, #222); border-radius: 10px; }`);
  ok(`#sidebar-main { width: 280px; display: flex; }`);
  ok(`@media (prefers-color-scheme: dark) { .tab-label { color: white; opacity: 0.9; } }`);
  ok(`@keyframes skein-pulse { from { background-color: red; } to { background-color: blue; } }`);
  ok(`.tab-icon-image { list-style-image: url("chrome://global/skin/icons/defaultFavicon.svg"); }`);
  ok(`.skein-space-button { background-image: url("data:image/png;base64,iVBORw0KGgo="); }`);
  ok(`#urlbar-input { color: #ffffff; font-family: "Inter", sans-serif; }`);
  ok(`.urlbar-background { background-color: rgb(20, 20, 30); border-radius: 12px; }`);
  ok(`#nav-bar { background: #111; padding-block: 6px; min-height: 44px; order: 2; }`);
  ok(`/* comment with url(http://x) */ .a { color: red; }`);
});

test("rejects remote loads", () => {
  bad(`@import url("https://evil.example/x.css");`, "css-at-rule");
  bad(`@import "https://evil.example/x.css";`, "css-at-rule");
  bad(`.a { background: url(https://evil.example/track.png); }`, "css-value");
  bad(`.a { background: url("//evil.example/track.png"); }`, "css-value");
  bad(`.a { background: URL( 'http://evil.example/a.png' ); }`, "css-value");
  bad(`.a { background: image-set("https://evil.example/a.png" 1x); }`, "css-value");
  bad(`.a { background: -webkit-image-set(url(a.png) 1x); }`, "css-value");
  bad(`.a { cursor: url(file:///etc/passwd), auto; }`, "css-value");
  bad(`.a { background: url(resource://gre/x.png); }`, "css-value");
  bad(`.a { background: url(moz-extension://abc/x.png); }`, "css-value");
  bad(`.a { background: url(javascript:alert(1)); }`);
  bad(`.a { background: url(data:text/html,<script>1</script>); }`, "css-value");
  bad(`@font-face { font-family: x; src: url(https://evil.example/f.woff2); }`, "css-value");
  bad(`.a { content: "https://evil.example"; }`, "css-value");
  bad(`.a { background: url(../../../profile/logins.json); }`, "css-value");
  bad(`.a { background: url(/etc/passwd.png); }`, "css-value");
  bad(`.a { background: -moz-element(#urlbar); }`, "css-value");
  bad(`.a { --my-x: https://evil.example/a; }`, "css-value");
});

test("rejects escape and parser tricks", () => {
  bad(`.a { background: \\75rl(https://evil.example); }`, "css-escape");
  bad(`#\\75rlbar { display: none; }`, "css-escape");
  bad(`.a { color: red; } } #urlbar { display: none; }`);
  bad(`.a { color: red; `);
  bad(`.a { color: "unterminated; }`);
  bad(`/* unterminated .a { color: red; }`);
  bad(`.a { .b { display: none; } }`, "css-nesting");
  bad(`.a { -moz-binding: url("chrome://x/y.xml#z"); }`);
  bad(`@namespace url(http://www.w3.org/1999/xhtml);`, "css-at-rule");
  bad(`@-moz-document url-prefix("https://bank.example") { body { display: none; } }`, "css-at-rule");
  bad(`@charset "utf-7";`, "css-at-rule");
  bad(`<!-- .a { color: red; } -->`);
  bad(`.a { color: red; behavior: url(x.htc); }`);
  bad(`.a { width: expression(alert(1)); }`, "css-value");
});

test("protects the address bar and site identity", () => {
  bad(`#urlbar { display: none; }`, "css-protected");
  bad(`#urlbar-input { color: transparent; }`, "css-protected");
  bad(`#urlbar-input { color: rgba(0,0,0,0); }`, "css-protected");
  bad(`#urlbar-input { color: #00000000; }`, "css-protected");
  bad(`#urlbar-input { color: var(--toolbar-bgcolor); }`, "css-protected");
  bad(`#urlbar-input { font-size: 0; }`, "css-protected");
  bad(`#urlbar-input { text-indent: -9999px; }`, "css-protected");
  bad(`#identity-box { visibility: hidden; }`, "css-protected");
  bad(`#identity-icon { list-style-image: url("chrome://global/skin/icons/security.svg"); }`, "css-protected");
  bad(`#identity-icon { opacity: 0; }`, "css-protected");
  bad(`#tracking-protection-icon-container { display: none; }`, "css-protected");
  bad(`.urlbar-input-container { transform: translateX(-9999px); }`, "css-protected");
  bad(`#identity-box::after { content: "bank.example"; }`, "css-protected");
  bad(`#urlbar-input::before { content: "https://bank.example"; }`);
  bad(`toolbar #URLBAR { display: none; }`, "css-protected");
  bad(`:is(#urlbar, .x) { display: none; }`, "css-protected");
  bad(`.x:not(#identity-box) , #identity-box { opacity: 0; }`, "css-protected");
  bad(`[id="urlbar"] { display: none; }`, "css-protected");
  bad(`[id^="url"] { display: none; }`, "css-protected");
  bad(`[id*="dentity"] { display: none; }`, "css-protected");
  bad(`[class~="urlbar-input-container"] { display: none; }`, "css-protected");
  bad(`#urlbar { --my-height: 0px; }`, "css-protected");
  bad(`#urlbar-scheme { display: none; }`, "css-protected");
  bad(`#urlbar-results { visibility: hidden; }`, "css-protected");
  bad(`#urlbar-zoom-button { position: fixed; }`, "css-protected");
  bad(`.urlbar-background { opacity: 0; }`, "css-protected");
  bad(`#identity-credential-notification-icon { display: none; }`, "css-protected");
  bad(`#tracking-protection-icon-tooltip { display: none; }`, "css-protected");
  bad(`#downloads-indicator-anchor { display: none; }`, "css-protected");
});

test("protects prompts, dialogs and downloads", () => {
  bad(`#notification-popup { display: none; }`, "css-protected");
  bad(`.popup-notification-body { visibility: collapse; }`, "css-protected");
  bad(`popupnotification { opacity: 0; }`, "css-protected");
  bad(`#downloadsPanel { margin-left: -5000px; }`, "css-protected");
  bad(`.dialogBox { transform: scale(0); }`, "css-protected");
  bad(`#fullscreen-warning { display: none; }`, "css-protected");
  bad(`#identity-popup { pointer-events: none; }`, "css-protected");
  bad(`#skein-privacy-indicator { display: none; }`, "css-protected");
});

test("containers cannot be hidden or displaced", () => {
  bad(`#nav-bar { display: none; }`, "css-container");
  bad(`#nav-bar { visibility: collapse; }`, "css-container");
  bad(`#navigator-toolbox { opacity: 0; }`, "css-container");
  bad(`#navigator-toolbox { max-height: 0; }`, "css-container");
  bad(`#navigator-toolbox { position: fixed; top: -200px; }`, "css-container");
  bad(`#urlbar-container { width: 0; }`, "css-protected");
  bad(`#main-window { filter: opacity(0); }`, "css-container");
  bad(`:root { visibility: hidden; }`, "css-container");
  bad(`#browser { transform: translateY(-100vh); }`, "css-container");
  bad(`#nav-bar { font-size: 0; }`, "css-container");
  bad(`#nav-bar { clip-path: inset(100%); }`, "css-container");
  bad(`#nav-bar > * { display: none; }`);
  bad(`#nav-bar::before { content: "🔒 bank.example"; }`, "css-protected");
  ok(`#nav-bar { display: flex; position: relative; }`);
});

test("broad selectors cannot hide things", () => {
  bad(`* { display: none; }`, "css-broad");
  bad(`toolbar > * { visibility: hidden; }`, "css-broad");
  bad(`hbox { opacity: 0; }`, "css-broad");
  bad(`image { display: none; }`, "css-broad");
  bad(`[anonid] { display: none; }`);
  bad(`:is(*) { display: none; }`, "css-broad");
  bad(`.x * { position: fixed; }`, "css-broad");
  bad(`input { color: red; font-size: 0; }`, "css-broad");
  bad(`@keyframes hide { to { opacity: 0; } }`, "css-broad");
  bad(`@keyframes hide { to { transform: translateX(-9999px); } }`, "css-broad");
  ok(`* { box-sizing: border-box; }`);
  ok(`toolbarbutton { border-radius: 8px; color: #eee; }`);
  ok(`.tab-close-button { display: none; }`);
  ok(`#TabsToolbar .titlebar-spacer { display: none; }`);
});

test("custom properties: only Skein tokens and --my-*", async () => {
  bad(`:root { --toolbar-field-text-color: #ffffff; }`, "css-custom-property");
  bad(`:root { --urlbar-min-height: 0px; }`, "css-custom-property");
  bad(`:root { --panel-text-color: #ffffff; }`, "css-custom-property");
  bad(`.a { --skein-made-up: red; }`, "css-custom-property");
  ok(`.a { --my-shadow: 0 1px 2px #000; box-shadow: var(--my-shadow); }`);
  const { TOKENS } = await import("../../browser/components/skein/SkeinSurface.sys.mjs");
  const { KNOWN_TOKENS } = await import("../../browser/components/skein/SkeinValidator.sys.mjs");
  assert.deepEqual([...KNOWN_TOKENS].sort(), Object.keys(TOKENS).sort(), "validator and surface token lists must match");
});

test("token pairs need literal colours with contrast", () => {
  ok(`:root { --skein-panel-bg: #1d1a2e; --skein-panel-fg: #e8e6f0; }`);
  ok(`:root { --skein-field-bg: light-dark(#ffffff, #1c1b22); --skein-field-fg: light-dark(#15141a, #fbfbfe); }`);
  ok(`:root { --skein-toolbar-bg: rgb(20, 20, 30); --skein-toolbar-fg: rgb(240 240 250); }`);
  bad(`:root { --skein-panel-bg: #ffffff; --skein-panel-fg: #ffffff; }`, "css-token-contrast");
  bad(`:root { --skein-panel-bg: #ffffff; --skein-panel-fg: #fefefe; }`, "css-token-contrast");
  bad(`:root { --skein-field-bg: #2a2640; --skein-field-fg: #2a2640; }`, "css-token-contrast");
  bad(`:root { --skein-field-bg: light-dark(#ffffff, #000000); --skein-field-fg: light-dark(#000000, #000000); }`, "css-token-contrast");
  bad(`:root { --skein-field-fg: #ffffff; }`, "css-token-pair");
  bad(`:root { --skein-panel-bg: #000000; }`, "css-token-pair");
  bad(`:root { --skein-field-bg: #2a2640; --skein-field-fg: transparent; }`, "css-token-pair");
  bad(`:root { --skein-field-bg: #2a2640; --skein-field-fg: var(--my-x); }`, "css-token-pair");
  bad(`:root { --skein-field-bg: #2a2640; --skein-field-fg: rgba(255,255,255,0); }`, "css-token-pair");
  bad(`:root { --skein-panel-bg: red; --skein-panel-fg: white; }`, "css-token-pair");
  bad(`:root { --skein-field-bg: #2a2640; } :root { --skein-field-fg: #ffffff; }`, "css-token-pair");
});

test("classifySelector", () => {
  assert.equal(classifySelector("#urlbar"), "protected");
  assert.equal(classifySelector(".tabbrowser-tab:hover"), "normal");
  assert.equal(classifySelector("#nav-bar .foo"), "container");
  assert.equal(classifySelector("toolbar"), "broad");
  assert.equal(classifySelector(".foo > image"), "broad");
  assert.equal(classifySelector(".foo:not(.bar)"), "normal");
  assert.equal(classifySelector(":root"), "container");
});

test("prefs allowlist", () => {
  assert.equal(validatePrefs({ prefs: { "sidebar.verticalTabs": true } }).errors.length, 0);
  assert.equal(validatePrefs({ prefs: { "browser.uidensity": 1 } }).errors.length, 0);
  for (const [name, value] of [
    ["network.proxy.type", 1],
    ["network.proxy.http", "evil.example"],
    ["security.enterprise_roots.enabled", true],
    ["browser.urlbar.trimURLs", true],
    ["signon.rememberSignons", true],
    ["xpinstall.signatures.required", false],
    ["devtools.chrome.enabled", true],
    ["toolkit.legacyUserProfileCustomizations.stylesheets", true],
    ["browser.startup.homepage", "https://evil.example"],
    ["sidebar.verticalTabs", "yes"],
    ["browser.uidensity", 7],
    ["__proto__", {}],
    ["constructor", 1],
  ]) {
    const res = validatePrefs(JSON.parse(JSON.stringify({ prefs: { [name]: value } }).replace('"__proto__"', '"__proto__"')));
    assert.ok(res.errors.length, `pref ${name} should be rejected`);
    assert.equal(Object.keys(res.prefs).length, 0);
  }
  assert.ok(validatePrefs(JSON.parse('{"prefs": {"__proto__": {"x": 1}}}')).errors.length);
});

test("layout schema", () => {
  const good = validateLayout({ tabs: { orientation: "vertical", side: "right" }, toolbar: { position: "bottom" }, density: "compact" });
  assert.equal(good.errors.length, 0);
  assert.deepEqual(good.layout.tabs, { orientation: "vertical", side: "right" });
  assert.ok(validateLayout({ tabs: { orientation: "diagonal" } }).errors.length);
  assert.ok(validateLayout({ urlbar: { hidden: true } }).errors.length);
  assert.ok(validateLayout({ toolbar: { position: "hidden" } }).errors.length);
  assert.ok(validateLayout([]).errors.length);
  assert.ok(validateLayout(JSON.parse('{"__proto__": {"a": 1}}')).errors.length);
});

test("keybindings", () => {
  assert.equal(validateKeybindings({ bindings: [{ command: "skein:next-space", key: "]", modifiers: ["accel", "alt"] }] }).errors.length, 0);
  assert.ok(validateKeybindings({ bindings: [{ command: "cmd_quitApplication", key: "q", modifiers: ["accel"] }] }).errors.length);
  assert.ok(validateKeybindings({ bindings: [{ command: "skein:next-space", key: "a" }] }).errors.length, "plain key rejected");
  assert.ok(validateKeybindings({ bindings: [{ command: "skein:next-space", key: "a", modifiers: ["shift"] }] }).errors.length);
  assert.ok(validateKeybindings({ bindings: [{ command: "skein:next-space", key: "<script>", modifiers: ["accel"] }] }).errors.length);
  assert.ok(
    validateKeybindings({
      bindings: [
        { command: "skein:next-space", key: "k", modifiers: ["accel"] },
        { command: "skein:new-space", key: "K", modifiers: ["accel"] },
      ],
    }).errors.length,
    "duplicates rejected"
  );
});

const skill = (id, touches, extra = {}) => ({
  [`skills/${id}/skill.json`]: JSON.stringify({ id, name: id, touches }),
  ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`skills/${id}/${k}`, v])),
});

test("bundle: happy path and per-space layering", () => {
  const files = {
    "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["midnight"], spaces: { Work: { enabled: ["calm"] } } }),
    ...skill("midnight", ["css", "layout"], {
      "chrome.css": ".tab-background { background-color: #111; }",
      "layout.json": JSON.stringify({ tabs: { orientation: "vertical", side: "left" } }),
    }),
    ...skill("calm", ["css", "prefs"], {
      "chrome.css": ".tab-label { color: #cde; }",
      "prefs.json": JSON.stringify({ prefs: { "browser.uidensity": 1 } }),
    }),
    "SKILL.md": "# instructions",
  };
  const res = validateBundle(files);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual(res.resolved.enabled, ["midnight"]);
  assert.equal(res.resolved.css.length, 1);
  assert.ok(res.warnings.some(w => w.code === "skill-disabled"));
  const work = validateBundle(files, { space: "Work" });
  assert.deepEqual(work.resolved.enabled, ["midnight", "calm"]);
  assert.equal(work.resolved.prefs["browser.uidensity"], 1);
});

test("bundle: empty folder is valid and applies nothing", () => {
  const res = validateBundle({});
  assert.equal(res.ok, true);
  assert.deepEqual(res.resolved.enabled, []);
});

test("bundle: all-or-nothing and declaration rules", () => {
  const base = { "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["good", "evil"] }) };
  const res = validateBundle({
    ...base,
    ...skill("good", ["css"], { "chrome.css": ".a { color: red; }" }),
    ...skill("evil", ["css"], { "chrome.css": "#urlbar { display: none; }" }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.resolved.css.length, 0, "nothing applies when any skill fails");

  // Undeclared file.
  let r = validateBundle({
    "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["a"] }),
    ...skill("a", ["css"], { "chrome.css": ".a{color:red}", "prefs.json": '{"prefs":{}}' }),
  });
  assert.ok(r.errors.some(e => e.code === "skill-undeclared"));

  // Declared but missing.
  r = validateBundle({ "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["a"] }), ...skill("a", ["css", "layout"], { "chrome.css": ".a{color:red}" }) });
  assert.ok(r.errors.some(e => e.code === "skill-missing-file"));

  // Unexpected files (scripts) in a skill folder.
  r = validateBundle({ "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["a"] }), ...skill("a", ["css"], { "chrome.css": ".a{color:red}", "run.js": "alert(1)" }) });
  assert.ok(r.errors.some(e => e.code === "skill-unknown-file"));
  r = validateBundle({ "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["a"] }), ...skill("a", ["css"], { "chrome.css": ".a{color:red}", "assets/x.js": "alert(1)" }) });
  assert.ok(r.errors.some(e => e.code === "skill-unknown-file"));

  // Bad ids / traversal.
  assert.equal(validateBundle({ "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["../x"] }) }).ok, false);
  assert.equal(validateBundle({ "skein.json": "{}", "../outside": "x" }).ok, false);
  assert.equal(validateBundle({ "skein.json": JSON.stringify({ formatVersion: 2 }) }).ok, false);
  assert.equal(validateBundle({ "skein.json": JSON.stringify({ formatVersion: 1, enabled: [], script: "x" }) }).ok, false);
  assert.equal(validateBundle({ "skein.json": "not json" }).ok, false);

  // Missing manifest, id mismatch.
  assert.equal(validateBundle({ "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["ghost"] }) }).ok, false);
  assert.equal(
    validateBundle({ "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["a"] }), "skills/a/skill.json": JSON.stringify({ id: "b", name: "x", touches: ["css"] }), "skills/a/chrome.css": "" }).ok,
    false
  );
});

test("bundle: assets must exist inside the skill", () => {
  const mk = css => ({
    "skein.json": JSON.stringify({ formatVersion: 1, enabled: ["a"] }),
    ...skill("a", ["css"], { "chrome.css": css, "assets/bg.png": "PNG" }),
  });
  assert.equal(validateBundle(mk(`.a { background-image: url("assets/bg.png"); }`)).ok, true);
  assert.equal(validateBundle(mk(`.a { background-image: url("assets/missing.png"); }`)).ok, false);
  assert.equal(validateBundle(mk(`.a { background-image: url("bg.png"); }`)).ok, false);
});

test("reference skills in examples/ are valid", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../../examples/custom/", import.meta.url));
  const files = {};
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files[relative(root, path).split("\\").join("/")] = readFileSync(path, "utf8");
      }
    }
  };
  walk(root);
  for (const space of [undefined, "Work"]) {
    const res = validateBundle(files, space ? { space } : {});
    assert.equal(res.ok, true, JSON.stringify(res.errors));
  }
  // Every installed skill must validate when enabled, not only the default set.
  const all = Object.keys(files).filter(f => f.endsWith("/skill.json")).map(f => f.split("/")[1]);
  const res = validateBundle({ ...files, "skein.json": JSON.stringify({ formatVersion: 1, enabled: all }) });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
});
