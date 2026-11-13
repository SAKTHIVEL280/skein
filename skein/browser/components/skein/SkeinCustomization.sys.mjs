/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * SkeinCustomization: loads the customization folder an external agent edits,
 * validates it, applies it live to browser windows, snapshots every applied
 * bundle and can roll back.
 *
 * Trust model (docs/SKEIN_PLAN.md section 6): the folder is untrusted input.
 * Nothing from it is applied unless SkeinValidator accepts the whole bundle
 * and the runtime integrity check passes on every open window.
 */

import { validateBundle, ALLOWED_PREFS } from "moz-src:///browser/components/skein/SkeinValidator.sys.mjs";
import { TOKENS } from "moz-src:///browser/components/skein/SkeinSurface.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SkeinAgentDocs: "moz-src:///browser/components/skein/SkeinAgentDocs.sys.mjs",
  SkeinSpaces: "moz-src:///browser/components/skein/SkeinSpaces.sys.mjs",
  clearInterval: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
});

const PREF_DIR = "skein.customization.dir";
const PREF_SAFE_MODE = "skein.safeMode";
const PREF_ENABLED = "skein.customization.enabled";
const POLL_MS = 1000;
const MAX_FILES = 500;
const MAX_DEPTH = 4;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOTS = 50;
const TOPIC_CHANGED = "skein-customization-changed";

const ASSET_MIME = {
  svg: "image/svg+xml",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  woff2: "font/woff2",
};
const TEXT_FILE_RE = /(^|\/)(skein\.json|skill\.json|chrome\.css|layout\.json|prefs\.json|keybindings\.json)$/;

/**
 * Elements checked after every apply. "hit" additionally requires that
 * nothing is painted over the element; "text" requires readable text colour.
 */
const INTEGRITY_TARGETS = [
  { selector: "#navigator-toolbox" },
  { selector: "#nav-bar" },
  { selector: "#urlbar-container" },
  { selector: "#urlbar", hit: true },
  { selector: "#urlbar-input", hit: true },
  { selector: "#identity-box", hit: true },
  { selector: "#identity-icon-box", hit: true },
  { selector: "#tracking-protection-icon-container", hit: true },
  // The page itself: nothing from a skill may be painted over web content.
  { selector: "#tabbrowser-tabpanels" },
  { selector: "browser[selected]", selectedBrowser: true, hit: true, exact: true, grid: 5 },
];

const KEYCODES = {
  Tab: "VK_TAB",
  Left: "VK_LEFT",
  Right: "VK_RIGHT",
  Up: "VK_UP",
  Down: "VK_DOWN",
  PageUp: "VK_PAGE_UP",
  PageDown: "VK_PAGE_DOWN",
  Home: "VK_HOME",
  End: "VK_END",
};

function hashString(str) {
  // FNV-1a, 32 bit. Change detection only; not a security boundary.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseColor(str) {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(str);
  if (!m) {
    return null;
  }
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

function luminance({ r, g, b }) {
  const f = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const SkeinCustomization = {
  _initialized: false,
  _timer: null,
  _busy: false,
  _lastSignature: null,
  /** Files of the bundle currently applied (Map path -> text), or null. */
  _appliedFiles: null,
  _appliedAssets: new Map(),
  _appliedHash: null,
  /** Per-window state: { sheetURI, keyset } */
  _windows: new WeakMap(),
  status: { state: "starting", time: 0, errors: [], warnings: [], integrity: [], enabled: [] },

  /* ---------------------------------------------------------------- paths */

  get rootDir() {
    const override = Services.prefs.getStringPref(PREF_DIR, "");
    if (override) {
      return PathUtils.parent(override);
    }
    // Deliberately not under the application's own data directory
    // (~/.config/skein, %APPDATA%\\Skein), which is where profiles live.
    const platform = Services.appinfo.OS;
    if (platform === "WINNT") {
      return PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "SkeinCustomization");
    }
    if (platform === "Darwin") {
      return PathUtils.join(Services.dirsvc.get("ULibDir", Ci.nsIFile).path, "Application Support", "SkeinCustomization");
    }
    const xdg = Services.env.get("XDG_CONFIG_HOME");
    const base = xdg || PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ".config");
    return PathUtils.join(base, "skein-customization");
  },

  /** The folder the agent edits. Never inside the profile. */
  get dir() {
    return Services.prefs.getStringPref(PREF_DIR, "") || PathUtils.join(this.rootDir, "custom");
  },

  /** Skein-owned state (snapshots, managed prefs). The agent has no business here. */
  get stateDir() {
    return PathUtils.join(this.rootDir, "state");
  },

  get snapshotDir() {
    return PathUtils.join(this.stateDir, "snapshots");
  },

  get safeMode() {
    return Services.appinfo.inSafeMode || Services.prefs.getBoolPref(PREF_SAFE_MODE, false) || !Services.prefs.getBoolPref(PREF_ENABLED, true);
  },

  /* ------------------------------------------------------------ lifecycle */

  browserFirstWindowReady() {
    this.init();
  },

  browserWindowDelayedStartup(win) {
    if (!this._initialized) {
      return;
    }
    this._ensureBaseline(win).then(async () => {
      if (win.closed) {
        return;
      }
      this._applyToWindow(win);
      if (this._checkWindow(win).length || (await this._checkText(win)).length) {
        this._removeSheet(win);
      }
    });
  },

  browserWindowUnload(win) {
    this._windows.delete(win);
  },

  async init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    // The customization folder must never live inside the profile folder
    // (passwords, cookies, history). Refuse such an override outright.
    const profile = PathUtils.profileDir;
    if (this.dir === profile || this.dir.startsWith(profile + (Services.appinfo.OS === "WINNT" ? "\\" : "/")) || profile.startsWith(this.dir)) {
      console.error("Skein: customization folder overlaps the profile folder; ignoring the override.");
      Services.prefs.clearUserPref(PREF_DIR);
    }
    try {
      await this._ensureFolder();
    } catch (e) {
      console.error("Skein: could not prepare customization folder", e);
    }
    await this.reload("startup");
    this._timer = lazy.setInterval(() => this._poll(), POLL_MS);
    Services.prefs.addObserver(PREF_SAFE_MODE, () => this.reload("safe-mode"));
    Services.prefs.addObserver(PREF_ENABLED, () => this.reload("enabled"));
    Services.obs.addObserver(() => {
      if (this._timer) {
        lazy.clearInterval(this._timer);
        this._timer = null;
      }
    }, "quit-application-granted");
  },

  async _ensureFolder() {
    await IOUtils.makeDirectory(this.dir, { createAncestors: true });
    await IOUtils.makeDirectory(PathUtils.join(this.dir, "skills"), { ignoreExisting: true });
    await IOUtils.makeDirectory(this.snapshotDir, { createAncestors: true });
    const rootFile = PathUtils.join(this.dir, "skein.json");
    if (!(await IOUtils.exists(rootFile))) {
      await IOUtils.writeUTF8(rootFile, JSON.stringify({ formatVersion: 1, enabled: [] }, null, 2) + "\n");
    }
    const skillMd = PathUtils.join(this.dir, "SKILL.md");
    if (!(await IOUtils.exists(skillMd))) {
      await this.writeAgentDocs();
    }
  },

  /** (Re)generate SKILL.md, the instruction file agents read before editing. */
  async writeAgentDocs() {
    const text = await lazy.SkeinAgentDocs.build({ dir: this.dir });
    await IOUtils.writeUTF8(PathUtils.join(this.dir, "SKILL.md"), text);
  },

  /**
   * Write Claude Code permission rules into the customization folder that
   * deny the agent the browser profile and Skein's own state. Other agents
   * have their own mechanisms; see docs/hardened-agent-setup.md.
   */
  async writeAgentPermissions() {
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    const rule = path => {
      const unix = path.replaceAll("\\", "/");
      const homeUnix = home.replaceAll("\\", "/");
      return unix.startsWith(homeUnix + "/") ? `~/${unix.slice(homeUnix.length + 1)}/**` : `//${unix.replace(/^\/+/, "")}/**`;
    };
    const protectedDirs = [PathUtils.profileDir, this.stateDir];
    // The profile root (profiles.ini and every profile), unless a custom
    // profile location makes it an ancestor of the customization folder.
    const profileRoot = PathUtils.parent(PathUtils.profileDir);
    if (profileRoot && !this.dir.startsWith(profileRoot)) {
      protectedDirs.unshift(profileRoot);
    }
    const globs = [...new Set(protectedDirs.map(rule)), "~/.ssh/**", "~/.gnupg/**", "~/.mozilla/**", "~/.config/mozilla/**"];
    const settings = {
      permissions: {
        deny: globs.flatMap(glob => [`Read(${glob})`, `Edit(${glob})`]),
      },
    };
    const dir = PathUtils.join(this.dir, ".claude");
    await IOUtils.makeDirectory(dir, { ignoreExisting: true });
    const path = PathUtils.join(dir, "settings.json");
    await IOUtils.writeUTF8(path, JSON.stringify(settings, null, 2) + "\n");
    return path;
  },

  /* ------------------------------------------------------- reading folder */

  async _walk(dir, rel, depth, out) {
    if (depth > MAX_DEPTH) {
      return;
    }
    let children;
    try {
      children = await IOUtils.getChildren(dir);
    } catch (e) {
      return;
    }
    for (const path of children) {
      if (out.length >= MAX_FILES) {
        out.overflow = true;
        return;
      }
      const name = PathUtils.filename(path);
      const relPath = rel ? `${rel}/${name}` : name;
      let stat;
      try {
        stat = await IOUtils.stat(path);
      } catch (e) {
        continue;
      }
      if (stat.type === "directory") {
        // Only descend into skills/: nothing else is ever loaded.
        if (depth > 0 || name === "skills") {
          await this._walk(path, relPath, depth + 1, out);
        }
      } else {
        out.push({ path, rel: relPath, size: stat.size, mtime: stat.lastModified, type: stat.type });
      }
    }
  },

  async _listFolder() {
    const out = [];
    await this._walk(this.dir, "", 0, out);
    out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
    return out;
  },

  _signature(entries) {
    return entries
      .filter(e => e.rel !== ".status.json" && e.rel !== "SKILL.md")
      .map(e => `${e.rel}:${e.size}:${e.mtime}`)
      .join("|");
  },

  /**
   * Read the folder into { files: Map<rel, text>, assets: Map<rel, Uint8Array>, errors }.
   * Symlinks and special files are refused: a link could point into the profile.
   */
  async _readFolder(entries) {
    const files = new Map();
    const assets = new Map();
    const errors = [];
    if (entries.overflow) {
      errors.push({ file: "", code: "too-many-files", message: `More than ${MAX_FILES} files in the customization folder.` });
    }
    for (const entry of entries) {
      if (entry.rel === ".status.json" || entry.rel === "SKILL.md") {
        continue;
      }
      let isLink = entry.type !== "regular";
      try {
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(entry.path);
        isLink ||= file.isSymlink();
      } catch (e) {
        isLink = true;
      }
      if (isLink) {
        errors.push({ file: entry.rel, code: "symlink", message: "Symbolic links and special files are not allowed." });
        continue;
      }
      try {
        if (TEXT_FILE_RE.test(entry.rel)) {
          if (entry.size > 512 * 1024) {
            errors.push({ file: entry.rel, code: "too-large", message: "File is too large." });
            continue;
          }
          files.set(entry.rel, await IOUtils.readUTF8(entry.path));
        } else if (/^skills\/[^/]+\/assets\//.test(entry.rel)) {
          if (entry.size > MAX_ASSET_BYTES) {
            errors.push({ file: entry.rel, code: "too-large", message: "Asset is larger than 2 MB." });
            continue;
          }
          assets.set(entry.rel, await IOUtils.read(entry.path));
          files.set(entry.rel, "");
        } else {
          // Present for the validator's unknown-file checks; content unused.
          files.set(entry.rel, "");
        }
      } catch (e) {
        errors.push({ file: entry.rel, code: "read", message: `Could not read file: ${e.message}` });
      }
    }
    return { files, assets, errors };
  },

  /* --------------------------------------------------------------- reload */

  async _poll() {
    if (this._busy) {
      return;
    }
    let entries;
    try {
      entries = await this._listFolder();
    } catch (e) {
      return;
    }
    if (this._signature(entries) !== this._lastSignature) {
      await this.reload("folder-changed", entries);
    }
  },

  /**
   * Validate the folder and, if it is acceptable, apply it everywhere.
   * Never throws; the outcome is in this.status.
   */
  async reload(reason, entries) {
    if (this._busy) {
      this._pending = reason;
      return;
    }
    this._busy = true;
    try {
      entries ||= await this._listFolder();
      this._lastSignature = this._signature(entries);

      if (this.safeMode) {
        this._applyBundle(new Map(), new Map());
        this._setStatus({ state: "safe-mode", errors: [], warnings: [], integrity: [], enabled: [] });
        return;
      }

      const { files, assets, errors } = await this._readFolder(entries);
      const result = errors.length ? { ok: false, errors, warnings: [] } : validateBundle(files);
      // Validate once per known space so a per-space skill cannot slip an
      // invalid bundle in later, at space-switch time.
      if (result.ok) {
        for (const space of lazy.SkeinSpaces.spaceNames()) {
          const r = validateBundle(files, { space });
          if (!r.ok) {
            result.ok = false;
            result.errors = r.errors;
            break;
          }
        }
      }
      if (!result.ok) {
        // Keep whatever was applied before; an invalid edit changes nothing.
        this._setStatus({ state: "rejected", errors: result.errors, warnings: result.warnings || [], integrity: [], enabled: this.status.enabled });
        return;
      }

      const hash = this._bundleHash(files, assets);
      const previous = { files: this._appliedFiles, assets: this._appliedAssets, hash: this._appliedHash };
      for (const win of lazy.BrowserWindowTracker.orderedWindows) {
        await this._ensureBaseline(win);
      }
      this._applyBundle(files, assets);
      let integrity = this._checkAllWindows();
      if (!integrity.length) {
        integrity = await this._checkTextAllWindows();
      }
      if (integrity.length) {
        this._applyBundle(previous.files || new Map(), previous.assets || new Map());
        this._appliedHash = previous.hash;
        this._setStatus({ state: "integrity-failed", errors: [], warnings: result.warnings, integrity, enabled: this.status.enabled });
        return;
      }
      this._appliedHash = hash;
      const warnings = [...result.warnings, ...this._surfaceWarnings(result.resolved)];
      if (hash !== previous.hash) {
        await this._snapshot(files, assets, hash, reason);
      }
      this._setStatus({ state: result.resolved.enabled.length ? "ok" : "empty", errors: [], warnings, integrity: [], enabled: result.resolved.enabled });
    } catch (e) {
      console.error("Skein: reload failed", e);
      this._setStatus({ state: "rejected", errors: [{ file: "", code: "internal", message: String(e) }], warnings: [], integrity: [], enabled: this.status.enabled });
    } finally {
      this._busy = false;
      if (this._pending) {
        const pending = this._pending;
        this._pending = null;
        this.reload(pending);
      }
    }
  },

  _bundleHash(files, assets) {
    let acc = "";
    for (const key of [...files.keys()].sort()) {
      acc += key + "\0" + files.get(key) + "\0";
      const bytes = assets.get(key);
      if (bytes) {
        acc += bytes.length + ":" + hashString(String.fromCharCode.apply(null, bytes.subarray(0, 4096))) + "\0";
      }
    }
    return hashString(acc);
  },

  _setStatus(partial) {
    this.status = { ...partial, time: Date.now(), dir: this.dir, safeMode: this.safeMode, appliedHash: this._appliedHash };
    Services.obs.notifyObservers(null, TOPIC_CHANGED);
    // Let the agent read the outcome of its edit.
    const forAgent = {
      state: this.status.state,
      time: new Date(this.status.time).toISOString(),
      enabled: this.status.enabled,
      errors: this.status.errors,
      warnings: this.status.warnings,
      integrity: this.status.integrity,
    };
    IOUtils.writeUTF8(PathUtils.join(this.dir, ".status.json"), JSON.stringify(forAgent, null, 2) + "\n").catch(() => {});
  },

  /* ---------------------------------------------------------------- apply */

  /** Apply an already-validated bundle to prefs and all windows. */
  _applyBundle(files, assets) {
    this._appliedFiles = files;
    this._appliedAssets = assets;
    this._resolvedCache = new Map();
    const top = lazy.BrowserWindowTracker.getTopWindow();
    const resolved = this._resolvedFor(top ? lazy.SkeinSpaces.activeSpaceName(top) : undefined);
    this._applyPrefs(this._prefTargets(resolved));
    for (const win of lazy.BrowserWindowTracker.orderedWindows) {
      this._applyToWindow(win);
    }
  },

  _resolvedFor(space) {
    const key = space === undefined ? "\0" : space;
    if (!this._resolvedCache.has(key)) {
      const res = validateBundle(this._appliedFiles || new Map(), space === undefined ? {} : { space });
      this._resolvedCache.set(key, res.resolved);
    }
    return this._resolvedCache.get(key);
  },

  /** Called by SkeinSpaces when a window switches space. */
  onSpaceChanged(win) {
    if (!this._initialized || !this._appliedFiles) {
      return;
    }
    if (win === lazy.BrowserWindowTracker.getTopWindow()) {
      this._applyPrefs(this._prefTargets(this._resolvedFor(lazy.SkeinSpaces.activeSpaceName(win))));
    }
    this._applyToWindow(win);
    // A per-space skill set was validated at load; still re-check the live window.
    const fail = problems => {
      if (problems.length) {
        this._removeSheet(win);
        this._setStatus({ ...this.status, state: "integrity-failed", integrity: problems });
      }
      return !!problems.length;
    };
    if (!fail(this._checkWindow(win))) {
      this._checkText(win).then(fail);
    }
  },

  _prefTargets(resolved) {
    const target = {};
    const layout = resolved.layout || {};
    if (layout.tabs) {
      if (layout.tabs.orientation === "vertical") {
        target["sidebar.revamp"] = true;
        target["sidebar.verticalTabs"] = true;
      } else if (layout.tabs.orientation === "horizontal") {
        target["sidebar.verticalTabs"] = false;
      }
      if (layout.tabs.side) {
        const left = layout.tabs.side === "left";
        target["sidebar.position_start"] = Services.locale.isAppLocaleRTL ? !left : left;
      }
      if (layout.tabs.expanded !== undefined) {
        target["sidebar.visibility"] = layout.tabs.expanded ? "always-show" : "expand-on-hover";
      }
    }
    if (layout.toolbar) {
      if (layout.toolbar.position) {
        target["skein.layout.toolbar.position"] = layout.toolbar.position;
      }
      if (layout.toolbar.bookmarksBar) {
        target["browser.toolbars.bookmarks.visibility"] = layout.toolbar.bookmarksBar;
      }
    }
    if (layout.density) {
      target["browser.uidensity"] = { normal: 0, compact: 1, touch: 2 }[layout.density];
    }
    if (layout.spaces?.showLabels !== undefined) {
      target["skein.spaces.showLabels"] = layout.spaces.showLabels;
    }
    for (const [name, value] of Object.entries(resolved.prefs || {})) {
      target[name] = value;
    }
    return target;
  },

  _readManaged() {
    try {
      return JSON.parse(Services.prefs.getStringPref("skein.customization.managedPrefs", "{}"));
    } catch (e) {
      return {};
    }
  },

  /**
   * Set allowlisted prefs, remembering the user's own value the first time a
   * pref is taken over, and restoring it when no skill sets it any more.
   */
  _applyPrefs(target) {
    const managed = this._readManaged();
    const prefs = Services.prefs;
    const setPref = (name, value) => {
      if (typeof value === "boolean") {
        prefs.setBoolPref(name, value);
      } else if (typeof value === "number") {
        prefs.setIntPref(name, value);
      } else {
        prefs.setStringPref(name, value);
      }
    };
    const getPref = name => {
      switch (prefs.getPrefType(name)) {
        case prefs.PREF_BOOL:
          return prefs.getBoolPref(name);
        case prefs.PREF_INT:
          return prefs.getIntPref(name);
        case prefs.PREF_STRING:
          return prefs.getStringPref(name);
      }
      return undefined;
    };
    for (const [name, value] of Object.entries(target)) {
      // Defence in depth: the validator already enforced the allowlist.
      if (!Object.hasOwn(ALLOWED_PREFS, name)) {
        continue;
      }
      try {
        if (!Object.hasOwn(managed, name)) {
          managed[name] = prefs.prefHasUserValue(name) ? { had: true, value: getPref(name) } : { had: false };
        }
        if (getPref(name) !== value) {
          setPref(name, value);
        }
      } catch (e) {
        console.error("Skein: could not set pref", name, e);
      }
    }
    for (const name of Object.keys(managed)) {
      if (Object.hasOwn(target, name)) {
        continue;
      }
      try {
        if (managed[name].had) {
          setPref(name, managed[name].value);
        } else {
          prefs.clearUserPref(name);
        }
      } catch (e) {
        console.error("Skein: could not restore pref", name, e);
      }
      delete managed[name];
    }
    prefs.setStringPref("skein.customization.managedPrefs", JSON.stringify(managed));
  },

  /** Inline assets as data: URLs so the sheet has no file dependencies. */
  _buildCss(resolved) {
    let out = "";
    for (const { id, css } of resolved.css || []) {
      const inlined = css.replace(/url\(\s*["']?(assets\/[^"')]+)["']?\s*\)/gi, (match, ref) => {
        const bytes = this._appliedAssets.get(`skills/${id}/${ref}`);
        const mime = ASSET_MIME[ref.split(".").pop().toLowerCase()];
        if (!bytes || !mime) {
          return "none";
        }
        return `url("data:${mime};base64,${bytesToBase64(bytes)}")`;
      });
      // Map Skein's stable tokens onto the upstream custom properties, in the
      // same rule the skill declared them in.
      const bridged = inlined.replace(/(--skein-[a-z-]+)\s*:\s*([^;{}"']+)(?=[;}])/g, (match, token, value) => {
        const maps = TOKENS[token]?.maps;
        return maps ? `${match}; ${maps.map(name => `${name}: ${value.trim()}`).join("; ")}` : match;
      });
      out += `/* skill: ${id} */\n${bridged}\n`;
    }
    return out;
  },

  _isEligible(win) {
    return (
      win &&
      !win.closed &&
      win.document.documentElement.getAttribute("windowtype") === "navigator:browser" &&
      // Private and Privacy-mode windows keep the stock, locked layout so the
      // user's customizations cannot become a fingerprint or a spoofing tool.
      !lazy.PrivateBrowsingUtils.isWindowPrivate(win)
    );
  },

  _removeSheet(win) {
    const state = this._windows.get(win);
    if (state?.sheetURI) {
      try {
        win.windowUtils.removeSheetUsingURIString(state.sheetURI, win.windowUtils.AUTHOR_SHEET);
      } catch (e) {}
      state.sheetURI = null;
    }
  },

  _applyToWindow(win) {
    if (!this._isEligible(win)) {
      return;
    }
    let state = this._windows.get(win);
    if (!state) {
      state = { sheetURI: null, keyset: null };
      this._windows.set(win, state);
    }
    const resolved = this._appliedFiles ? this._resolvedFor(lazy.SkeinSpaces.activeSpaceName(win)) : { css: [], keybindings: [] };

    // Stylesheet.
    const css = this._buildCss(resolved);
    const uri = css ? "data:text/css;charset=utf-8," + encodeURIComponent(css) : null;
    if (uri !== state.sheetURI) {
      this._removeSheet(win);
      if (uri) {
        try {
          win.windowUtils.loadSheetUsingURIString(uri, win.windowUtils.AUTHOR_SHEET);
          state.sheetURI = uri;
        } catch (e) {
          console.error("Skein: could not load skill stylesheet", e);
        }
      }
    }

    // Keybindings.
    state.keyset?.remove();
    state.keyset = null;
    if (resolved.keybindings?.length) {
      const doc = win.document;
      const keyset = doc.createXULElement("keyset");
      keyset.id = "skein-keyset";
      for (const binding of resolved.keybindings) {
        const key = doc.createXULElement("key");
        if (KEYCODES[binding.key]) {
          key.setAttribute("keycode", KEYCODES[binding.key]);
        } else if (/^F\d+$/.test(binding.key)) {
          key.setAttribute("keycode", "VK_" + binding.key);
        } else {
          key.setAttribute("key", binding.key === "Space" ? " " : binding.key);
        }
        if (binding.modifiers.length) {
          key.setAttribute("modifiers", binding.modifiers.join(","));
        }
        const command = binding.command;
        key.addEventListener("command", () => this.runCommand(win, command));
        keyset.appendChild(key);
      }
      doc.documentElement.appendChild(keyset);
      state.keyset = keyset;
    }
  },

  runCommand(win, command) {
    const spaces = lazy.SkeinSpaces;
    const m = /^skein:space-([1-9])$/.exec(command);
    if (m) {
      spaces.switchToIndex(win, Number(m[1]) - 1);
      return;
    }
    switch (command) {
      case "skein:next-space":
        spaces.cycle(win, 1);
        break;
      case "skein:previous-space":
        spaces.cycle(win, -1);
        break;
      case "skein:new-space":
        spaces.promptNewSpace(win);
        break;
      case "skein:toggle-vertical-tabs": {
        const on = Services.prefs.getBoolPref("sidebar.verticalTabs", false);
        if (!on) {
          Services.prefs.setBoolPref("sidebar.revamp", true);
        }
        Services.prefs.setBoolPref("sidebar.verticalTabs", !on);
        break;
      }
      case "skein:toggle-sidebar":
        win.SidebarController?.toggle();
        break;
      case "skein:open-settings":
        win.switchToTabHavingURI("about:skein", true);
        break;
      case "skein:rollback":
        this.rollbackToPrevious();
        break;
    }
  },

  /* ------------------------------------------------------------ integrity */

  _measure(win) {
    const doc = win.document;
    const out = new Map();
    for (const target of INTEGRITY_TARGETS) {
      const el = target.selectedBrowser ? win.gBrowser?.selectedBrowser : doc.querySelector(target.selector);
      out.set(target.selector, this._measureElement(win, el, target));
    }
    return out;
  },

  _measureElement(win, el, target) {
    if (!el) {
      return "missing";
    }
    const doc = win.document;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      return "collapsed";
    }
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx < 0 || cy < 0 || cx > win.innerWidth || cy > win.innerHeight) {
      return "moved off-screen";
    }
    for (let node = el; node && node.nodeType === 1; node = node.flattenedTreeParentNode) {
      const cs = win.getComputedStyle(node);
      if (cs.display === "none" || cs.visibility !== "visible") {
        return "hidden";
      }
      if (parseFloat(cs.opacity) < 0.9) {
        return "transparent";
      }
      if (cs.filter !== "none" || (cs.clipPath && cs.clipPath !== "none") || (cs.maskImage && cs.maskImage !== "none")) {
        return "filtered or clipped";
      }
    }
    if (target.hit) {
      const points = [];
      if (target.grid) {
        for (let i = 0; i < target.grid; i++) {
          for (let j = 0; j < target.grid; j++) {
            points.push([rect.left + 4 + ((rect.width - 8) * i) / (target.grid - 1), rect.top + 4 + ((rect.height - 8) * j) / (target.grid - 1)]);
          }
        }
      } else {
        points.push([cx, cy], [rect.left + 3, cy], [rect.right - 3, cy]);
      }
      for (const [x, y] of points) {
        let hit = doc.elementFromPoint(x, y);
        // Walk out of anonymous/shadow content to the element that owns it.
        while (hit && !el.contains(hit) && hit.containingShadowRoot) {
          hit = hit.containingShadowRoot.host;
        }
        if (target.exact ? hit !== el : !hit || !(el.contains(hit) || (target.selector === "#urlbar" && hit.closest?.("#urlbar")))) {
          return "covered by another element";
        }
      }
    }
    return "ok";
  },

  /**
   * Compare the live window against its own baseline (the same window with no
   * skill stylesheet). Anything visible in the baseline must stay visible.
   * Returns a list of problems (empty when the window is intact).
   */
  _checkWindow(win) {
    if (!this._isEligible(win)) {
      return [];
    }
    const state = this._windows.get(win);
    if (!state?.sheetURI) {
      return [];
    }
    const utils = win.windowUtils;
    // Force every box to take part in hit-testing, so an overlay cannot hide
    // from elementFromPoint by setting pointer-events: none.
    const probe = "data:text/css;charset=utf-8," + encodeURIComponent("*, *::before, *::after { pointer-events: auto !important; }");
    const problems = [];
    try {
      utils.removeSheetUsingURIString(state.sheetURI, utils.AUTHOR_SHEET);
      utils.loadSheetUsingURIString(probe, utils.AGENT_SHEET);
      const baseline = this._measure(win);
      utils.loadSheetUsingURIString(state.sheetURI, utils.AUTHOR_SHEET);
      const after = this._measure(win);
      for (const [selector, before] of baseline) {
        const now = after.get(selector);
        if (before === "ok" && now !== "ok") {
          problems.push({ selector, problem: now });
        }
      }
    } catch (e) {
      problems.push({ selector: "", problem: `integrity check failed to run: ${e}` });
    } finally {
      try {
        utils.removeSheetUsingURIString(probe, utils.AGENT_SHEET);
      } catch (e) {}
    }
    return problems;
  },

  /**
   * Is the address bar text distinguishable from what is actually painted
   * behind it? Reads real pixels, because the backdrop can come from a
   * sibling box, a background-image or the window frame.
   * Returns "ok", a problem string, or null when it cannot tell.
   */
  async _textLegibility(win) {
    try {
      const el = win.document.getElementById("urlbar-input");
      const rect = el?.getBoundingClientRect();
      const fg = el && parseColor(win.getComputedStyle(el).color);
      if (!rect || rect.width < 8 || rect.height < 8 || !fg) {
        return null;
      }
      const area = new win.DOMRect(rect.left, rect.top, Math.min(rect.width, 240), rect.height);
      const bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(area, 1, "rgb(255, 255, 255)");
      const canvas = new win.OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // The most common colour (4 bits per channel) is the backdrop.
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
        const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        bucket.n++;
        bucket.r += data[i];
        bucket.g += data[i + 1];
        bucket.b += data[i + 2];
        buckets.set(key, bucket);
      }
      let best = null;
      for (const bucket of buckets.values()) {
        if (!best || bucket.n > best.n) {
          best = bucket;
        }
      }
      if (!best) {
        return null;
      }
      const bg = { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
      const text = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      return contrast(text, bg) < 1.5 ? "address bar text cannot be told apart from its background" : "ok";
    } catch (e) {
      return null;
    }
  },

  /** Record whether the stock window (no skill sheet) has legible text. */
  async _ensureBaseline(win) {
    if (!this._isEligible(win)) {
      return;
    }
    let state = this._windows.get(win);
    if (!state) {
      state = { sheetURI: null, keyset: null };
      this._windows.set(win, state);
    }
    if (state.textBaseline === undefined && !state.sheetURI) {
      state.textBaseline = null;
      state.textBaseline = await this._textLegibility(win);
    }
  },

  async _checkText(win) {
    const state = this._windows.get(win);
    if (!this._isEligible(win) || !state?.sheetURI || state.textBaseline !== "ok") {
      return [];
    }
    const result = await this._textLegibility(win);
    return result && result !== "ok" ? [{ selector: "#urlbar-input", problem: result }] : [];
  },

  async _checkTextAllWindows() {
    for (const win of lazy.BrowserWindowTracker.orderedWindows) {
      const problems = await this._checkText(win);
      if (problems.length) {
        return problems;
      }
    }
    return [];
  },

  _checkAllWindows() {
    const problems = [];
    for (const win of lazy.BrowserWindowTracker.orderedWindows) {
      // Customize mode and DOM fullscreen legitimately rearrange the chrome.
      if (win.document.documentElement.hasAttribute("customizing") || win.document.fullscreenElement) {
        continue;
      }
      problems.push(...this._checkWindow(win));
      if (problems.length) {
        break;
      }
    }
    return problems;
  },

  /** Post-update compatibility hints: ids in skill CSS that match nothing. */
  _surfaceWarnings(resolved) {
    const warnings = [];
    const win = lazy.BrowserWindowTracker.getTopWindow();
    if (!win || !this._isEligible(win)) {
      return warnings;
    }
    for (const { id, css } of resolved.css || []) {
      const seen = new Set();
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{[^}]*\}/g, "{}");
      for (const m of stripped.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)) {
        if (!seen.has(m[1]) && !win.document.getElementById(m[1])) {
          seen.add(m[1]);
          warnings.push({ file: `skills/${id}/chrome.css`, code: "selector-unmatched", message: `#${m[1]} matches nothing in this version of Skein (it may have been renamed).` });
        }
      }
    }
    return warnings;
  },

  /* ------------------------------------------------------------ snapshots */

  async _snapshot(files, assets, hash, reason) {
    const time = Date.now();
    const id = `${new Date(time).toISOString().replace(/[:.]/g, "-")}_${hash}`;
    const data = {
      id,
      time,
      hash,
      reason,
      files: Object.fromEntries([...files].filter(([k]) => !assets.has(k))),
      assets: Object.fromEntries([...assets].map(([k, v]) => [k, bytesToBase64(v)])),
    };
    try {
      await IOUtils.makeDirectory(this.snapshotDir, { createAncestors: true });
      await IOUtils.writeUTF8(PathUtils.join(this.snapshotDir, id + ".json"), JSON.stringify(data));
      const all = (await IOUtils.getChildren(this.snapshotDir)).filter(p => p.endsWith(".json")).sort();
      for (const old of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS))) {
        await IOUtils.remove(old);
      }
    } catch (e) {
      console.error("Skein: could not write snapshot", e);
    }
    return id;
  },

  /** Newest first. */
  async listSnapshots() {
    let paths = [];
    try {
      paths = (await IOUtils.getChildren(this.snapshotDir)).filter(p => p.endsWith(".json")).sort().reverse();
    } catch (e) {}
    const out = [];
    for (const path of paths) {
      try {
        const data = JSON.parse(await IOUtils.readUTF8(path));
        let enabled = [];
        try {
          enabled = JSON.parse(data.files["skein.json"] || "{}").enabled || [];
        } catch (e) {}
        out.push({ id: data.id, time: data.time, hash: data.hash, reason: data.reason, enabled, current: data.hash === this._appliedHash });
      } catch (e) {}
    }
    return out;
  },

  async readSnapshot(id) {
    if (!/^[0-9A-Za-z_-]+$/.test(id)) {
      throw new Error("bad snapshot id");
    }
    return JSON.parse(await IOUtils.readUTF8(PathUtils.join(this.snapshotDir, id + ".json")));
  },

  /**
   * Restore the customization folder to a snapshot. The current folder is
   * snapshotted first (even if it is invalid), so a rollback can be undone.
   */
  async rollback(id) {
    const snapshot = await this.readSnapshot(id);
    const entries = await this._listFolder();
    const current = await this._readFolder(entries);
    const currentHash = this._bundleHash(current.files, current.assets);
    if (currentHash !== snapshot.hash) {
      await this._snapshot(current.files, current.assets, currentHash, "before-rollback");
    }
    // Stop the poller from seeing a half-written folder.
    this._busy = true;
    try {
      await IOUtils.remove(PathUtils.join(this.dir, "skills"), { recursive: true, ignoreAbsent: true });
      await IOUtils.remove(PathUtils.join(this.dir, "skein.json"), { ignoreAbsent: true });
      const write = async (rel, writer) => {
        if (rel.includes("..") || rel.startsWith("/") || rel.includes("\\")) {
          return;
        }
        const path = PathUtils.join(this.dir, ...rel.split("/"));
        await IOUtils.makeDirectory(PathUtils.parent(path), { createAncestors: true });
        await writer(path);
      };
      for (const [rel, text] of Object.entries(snapshot.files)) {
        await write(rel, path => IOUtils.writeUTF8(path, text));
      }
      for (const [rel, b64] of Object.entries(snapshot.assets || {})) {
        await write(rel, path => IOUtils.write(path, base64ToBytes(b64)));
      }
      await IOUtils.makeDirectory(PathUtils.join(this.dir, "skills"), { ignoreExisting: true });
    } finally {
      this._busy = false;
    }
    await this.reload("rollback");
  },

  /** One-click undo: go back to the bundle applied before the current one. */
  async rollbackToPrevious() {
    const snapshots = await this.listSnapshots();
    const previous = snapshots.find(s => s.hash !== this._appliedHash);
    if (previous) {
      await this.rollback(previous.id);
    }
    return previous?.id || null;
  },

  /** Turn every skill off without deleting anything. */
  async disableAll() {
    const path = PathUtils.join(this.dir, "skein.json");
    await IOUtils.writeUTF8(path, JSON.stringify({ formatVersion: 1, enabled: [] }, null, 2) + "\n");
    await this.reload("disable-all");
  },

  /** Skills present on disk, with their manifests (for about:skein). */
  async listSkills() {
    const out = [];
    let children = [];
    try {
      children = await IOUtils.getChildren(PathUtils.join(this.dir, "skills"));
    } catch (e) {}
    for (const path of children.sort()) {
      const id = PathUtils.filename(path);
      let manifest = null;
      try {
        manifest = JSON.parse(await IOUtils.readUTF8(PathUtils.join(path, "skill.json")));
      } catch (e) {}
      out.push({
        id,
        name: typeof manifest?.name === "string" ? manifest.name : id,
        description: typeof manifest?.description === "string" ? manifest.description : "",
        touches: Array.isArray(manifest?.touches) ? manifest.touches.filter(t => typeof t === "string") : [],
        enabled: this.status.enabled?.includes(id) || false,
      });
    }
    return out;
  },

  /** Enable or disable one skill globally by editing skein.json. */
  async setSkillEnabled(id, enabled) {
    const path = PathUtils.join(this.dir, "skein.json");
    let root;
    try {
      root = JSON.parse(await IOUtils.readUTF8(path));
    } catch (e) {
      root = { formatVersion: 1, enabled: [] };
    }
    const list = Array.isArray(root.enabled) ? root.enabled.filter(x => x !== id) : [];
    if (enabled) {
      list.push(id);
    }
    root.enabled = list;
    await IOUtils.writeUTF8(path, JSON.stringify(root, null, 2) + "\n");
    await this.reload("toggle-skill");
  },
};
