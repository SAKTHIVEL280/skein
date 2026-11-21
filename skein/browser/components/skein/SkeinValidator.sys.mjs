/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * SkeinValidator: static validation of the Skein customization folder.
 *
 * This module is deliberately free of Gecko dependencies so the same file runs
 * inside the browser and under Node for the adversarial test suite
 * (skein/tests/validator). Everything in the customization folder is untrusted
 * input: it is written by an external agent Skein cannot sandbox. The validator
 * fails closed: anything it does not understand is rejected.
 *
 * The static checks here are the first of two layers. The second layer is the
 * runtime integrity check in SkeinCustomization.sys.mjs, which inspects the
 * live window after a bundle is applied and rolls back if a protected element
 * is hidden, covered, or unreadable.
 */

export const FORMAT_VERSION = 1;

export const LIMITS = {
  maxFileBytes: 512 * 1024,
  maxSkills: 64,
  maxDataUrlBytes: 256 * 1024,
  maxKeybindings: 128,
};

const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TOUCHES = ["css", "layout", "prefs", "keybindings"];
const SKILL_FILES = {
  css: "chrome.css",
  layout: "layout.json",
  prefs: "prefs.json",
  keybindings: "keybindings.json",
};

/**
 * Security UI. A rule that names any of these may only set properties from
 * COSMETIC_PROPS, and only with opaque literal values.
 */
export const PROTECTED_TOKENS = [
  // Address bar and site identity.
  "urlbar",
  "urlbar-input",
  "urlbar-input-container",
  "urlbar-input-box",
  "urlbar-scheme",
  "identity-box",
  "identity-icon-box",
  "identity-icon",
  "identity-icon-label",
  "identity-permission-box",
  "identity-popup",
  "tracking-protection-icon-container",
  "tracking-protection-icon-box",
  "tracking-protection-icon",
  "protections-popup",
  "permissions-granted-icon",
  "blocked-permissions-container",
  "urlbar-label-box",
  "urlbar-revert-button-container",
  "trust-icon-container",
  "trust-icon",
  // Permission, notification and download prompts.
  "notification-popup",
  "notification-popup-box",
  "popup-notification",
  "popup-notification-body",
  "popup-notification-origin",
  "popupnotification",
  "permission-popup",
  "permissionList",
  "downloadsPanel",
  "downloadsPanel-mainView",
  "downloads-button",
  "unified-extensions-panel",
  "addon-webext-permissions-notification",
  "addon-install-confirmation-notification",
  "appMenu-popup",
  // Tab-modal and window-modal dialogs (auth prompts, beforeunload, etc.).
  "dialogStack",
  "dialogOverlay",
  "dialogBox",
  "dialogFrame",
  "window-modal-dialog",
  "commonDialog",
  // External-protocol / fullscreen / pointer-lock warnings.
  "fullscreen-warning",
  "pointerlock-warning",
  // Skein's own trust UI.
  "skein-privacy-indicator",
  "skein-safe-mode-indicator",
];

/**
 * Any id, class or tag starting with one of these is treated as security UI.
 * Firefox has well over a hundred urlbar-*, identity-* and *-notification-*
 * elements; listing them one by one would go stale on the next update.
 */
export const PROTECTED_PREFIXES = [
  "urlbar",
  "identity-",
  "tracking-protection",
  "trust-icon",
  "protections-popup",
  "popup-notification",
  "notification-popup",
  "permission",
  "downloads",
  "dialog",
  "commondialog",
  "fullscreen-warning",
  "pointerlock",
];

/**
 * Ancestors of security UI. Rules naming these may restyle and reorder them,
 * but may not use properties that can hide, shrink or displace them.
 */
export const CONTAINER_TOKENS = [
  "main-window",
  "navigator-toolbox",
  "nav-bar",
  "nav-bar-customization-target",
  "urlbar-container",
  "browser",
  "tabbrowser-tabbox",
  "tabbrowser-tabpanels",
  "mainPopupSet",
  "notifications-toolbar",
  "global-notificationbox",
  "tab-notification-deck",
  "notificationbox",
  "browserContainer",
  "browserStack",
  "browserSidebarContainer",
];

/** Properties allowed on PROTECTED_TOKENS selectors. */
const COSMETIC_PROPS = new Set([
  "color",
  "background-color",
  "border-color",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-start-start-radius",
  "border-start-end-radius",
  "border-end-start-radius",
  "border-end-end-radius",
  "outline-color",
  "font-family",
  "font-weight",
  "caret-color",
]);

/** Properties that can hide, shrink, displace or disable an element. */
const RISKY_PROPS = new Set([
  "all",
  "display",
  "visibility",
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
  "clip",
  "clip-path",
  "mask",
  "mask-image",
  "filter",
  "backdrop-filter",
  "position",
  "inset",
  "inset-block",
  "inset-inline",
  "inset-block-start",
  "inset-block-end",
  "inset-inline-start",
  "inset-inline-end",
  "top",
  "left",
  "right",
  "bottom",
  "z-index",
  "width",
  "height",
  "max-width",
  "max-height",
  "inline-size",
  "block-size",
  "max-inline-size",
  "max-block-size",
  "font-size",
  "line-height",
  "pointer-events",
  "content-visibility",
  "contain",
  "overflow",
  "overflow-x",
  "overflow-y",
  "overflow-inline",
  "overflow-block",
  "margin",
  "margin-top",
  "margin-left",
  "margin-right",
  "margin-bottom",
  "margin-block",
  "margin-inline",
  "margin-block-start",
  "margin-block-end",
  "margin-inline-start",
  "margin-inline-end",
  "text-indent",
  "color-scheme",
  "mix-blend-mode",
  "-moz-window-opacity",
  "-moz-window-transform",
  "-moz-user-focus",
  "-moz-user-input",
  "user-select",
  "appearance",
  "-moz-appearance",
  "-moz-default-appearance",
  "animation",
  "animation-name",
  "transition",
  "zoom",
  "flex",
  "flex-basis",
  "flex-shrink",
]);

/**
 * Custom properties a skill may declare: Skein's stable tokens (kept in sync
 * with SkeinSurface.sys.mjs by a test) and private --my-* variables. Firefox's
 * own custom properties are off limits: several of them size or colour
 * security UI (the address bar, permission panels).
 */
export const KNOWN_TOKENS = [
  "--skein-chrome-bg",
  "--skein-chrome-fg",
  "--skein-toolbar-bg",
  "--skein-toolbar-fg",
  "--skein-field-bg",
  "--skein-field-fg",
  "--skein-field-border",
  "--skein-accent",
  "--skein-tab-selected-bg",
  "--skein-sidebar-bg",
  "--skein-sidebar-fg",
  "--skein-panel-bg",
  "--skein-panel-fg",
  "--skein-radius",
];

/**
 * Background/text token pairs. They must be set together, as literal colours,
 * with enough contrast: panels show permission prompts and the field shows the
 * address, and neither is on screen when the runtime check runs.
 */
export const TOKEN_PAIRS = [
  ["--skein-chrome-bg", "--skein-chrome-fg"],
  ["--skein-toolbar-bg", "--skein-toolbar-fg"],
  ["--skein-field-bg", "--skein-field-fg"],
  ["--skein-sidebar-bg", "--skein-sidebar-fg"],
  ["--skein-panel-bg", "--skein-panel-fg"],
];
const MIN_PAIR_CONTRAST = 3;

/** Properties rejected everywhere. */
const BANNED_PROPS = new Set(["-moz-binding", "behavior", "-moz-context-properties-unsafe"]);

/** Functions rejected everywhere (they load or mirror arbitrary content). */
const BANNED_FUNCTIONS = [
  "image-set(",
  "-moz-image-set(",
  "-webkit-image-set(",
  "src(",
  "-moz-element(",
  "element(",
  "expression(",
  "cross-fade(",
  "paint(",
];

const ALLOWED_AT_RULES = new Set(["media", "supports", "keyframes", "font-face", "layer", "container"]);

const DATA_IMAGE_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i;
const CHROME_IMAGE_RE = /^chrome:\/\/(browser|global|branding)\/(skin|content)\/[A-Za-z0-9_./-]+\.(svg|png|gif|webp|jpg)$/;
const RELATIVE_ASSET_RE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\.(svg|png|gif|webp|jpg|jpeg|woff2)$/;

/**
 * Preferences a skill may set, with a validator per pref. Nothing outside this
 * table is ever written. Keep this list interface-only: no network, security,
 * privacy, extension, update or devtools prefs.
 */
export const ALLOWED_PREFS = {
  "sidebar.verticalTabs": "boolean",
  "sidebar.revamp": "boolean",
  "sidebar.position_start": "boolean",
  "sidebar.visibility": ["always-show", "hide-sidebar", "expand-on-hover"],
  "sidebar.main.tools": /^[a-z,]{0,128}$/,
  "browser.uidensity": [0, 1, 2],
  "browser.compactmode.show": "boolean",
  "browser.toolbars.bookmarks.visibility": ["always", "never", "newtab"],
  "browser.tabs.tabMinWidth": [50, 400],
  "browser.tabs.closeWindowWithLastTab": "boolean",
  "browser.tabs.insertAfterCurrent": "boolean",
  "browser.tabs.groups.enabled": "boolean",
  "browser.tabs.hoverPreview.enabled": "boolean",
  "browser.tabs.hoverPreview.showThumbnails": "boolean",
  "browser.tabs.inTitlebar": [0, 2],
  "browser.theme.toolbar-theme": [0, 2],
  "browser.theme.content-theme": [0, 2],
  "ui.prefersReducedMotion": [0, 1],
  "ui.systemUsesDarkTheme": [0, 1],
  "layout.css.prefers-color-scheme.content-override": [0, 3],
  "skein.spaces.showLabels": "boolean",
  "skein.layout.toolbar.position": ["top", "bottom"],
  "skein.ui.zen": "boolean",
  "skein.ui.topSearchBar": "boolean",
  "skein.ui.topBar": "boolean",
  "skein.ui.tabCloseButton": ["hover", "always", "never"],
  "skein.focus.compact": "boolean",
  "skein.focus.sidebarHidden": "boolean",
  "skein.focus.floatingNewTab": "boolean",
  "skein.glance.altClick": "boolean",
};
// Deliberately absent: browser.urlbar.trimURLs and anything else that changes
// how the address is displayed.

export const LAYOUT_SCHEMA = {
  tabs: {
    orientation: ["horizontal", "vertical"],
    side: ["left", "right"],
    expanded: "boolean",
  },
  toolbar: {
    position: ["top", "bottom"],
    bookmarksBar: ["always", "never", "newtab"],
  },
  density: ["compact", "normal", "touch"],
  spaces: {
    showLabels: "boolean",
  },
};

/** Commands a keybinding may trigger. */
export const ALLOWED_COMMANDS = new Set([
  "skein:next-space",
  "skein:previous-space",
  "skein:new-space",
  "skein:toggle-vertical-tabs",
  "skein:toggle-sidebar",
  "skein:open-settings",
  "skein:rollback",
  "skein:space-1",
  "skein:space-2",
  "skein:space-3",
  "skein:space-4",
  "skein:space-5",
  "skein:space-6",
  "skein:space-7",
  "skein:space-8",
  "skein:space-9",
]);

const ALLOWED_MODIFIERS = new Set(["accel", "shift", "alt", "control", "meta"]);
const KEY_RE = /^([A-Za-z0-9]|F([1-9]|1[0-9]|2[0-4])|[\[\]\\;',./`=-]|Tab|Space|Left|Right|Up|Down|PageUp|PageDown|Home|End)$/;

/* ------------------------------------------------------------------------ */
/* CSS                                                                      */
/* ------------------------------------------------------------------------ */

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/**
 * Replace comments with spaces (preserving offsets) and reject constructs the
 * parser will not reason about. Returns { text } or { error, index }.
 */
function preprocessCss(css) {
  if (css.includes("\\")) {
    return {
      error: "Backslash escapes are not allowed in skill CSS (they can disguise forbidden tokens).",
      code: "css-escape",
      index: css.indexOf("\\"),
    };
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(css)) {
    return { error: "Control characters are not allowed.", code: "css-control-char", index: 0 };
  }
  let out = "";
  let i = 0;
  let quote = null;
  while (i < css.length) {
    const c = css[i];
    if (quote) {
      if (c === "\n") {
        return { error: "Unterminated string.", code: "css-string", index: i };
      }
      if (c === quote) {
        quote = null;
      }
      out += c;
      i++;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
      i++;
    } else if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) {
        return { error: "Unterminated comment.", code: "css-comment", index: i };
      }
      out += css.slice(i, end + 2).replace(/[^\n]/g, " ");
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  if (quote) {
    return { error: "Unterminated string.", code: "css-string", index: css.length - 1 };
  }
  if (out.includes("<!--") || out.includes("-->")) {
    return { error: "CDO/CDC tokens are not allowed.", code: "css-cdo", index: 0 };
  }
  return { text: out };
}

/**
 * Parse a block's content into a list of rules:
 *   { type: "rule", prelude, body, index }
 *   { type: "at", name, prelude, body|null, index }
 * Throws {message, code, index} on malformed input.
 */
function parseRules(text, base) {
  const rules = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) {
      i++;
    }
    if (i >= n) {
      break;
    }
    const start = i;
    let quote = null;
    let paren = 0;
    let bracket = 0;
    let end = -1;
    let terminator = null;
    for (; i < n; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) {
          quote = null;
        }
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "(") {
        paren++;
      } else if (c === ")") {
        paren--;
      } else if (c === "[") {
        bracket++;
      } else if (c === "]") {
        bracket--;
      } else if (paren === 0 && bracket === 0 && (c === "{" || c === ";" || c === "}")) {
        end = i;
        terminator = c;
        break;
      }
      if (paren < 0 || bracket < 0) {
        throw { message: "Unbalanced brackets.", code: "css-syntax", index: base + i };
      }
    }
    if (end === -1 || terminator === "}") {
      throw { message: "Unexpected end of rule.", code: "css-syntax", index: base + start };
    }
    const prelude = text.slice(start, end).trim();
    if (terminator === ";") {
      if (!prelude.startsWith("@")) {
        throw { message: "Declaration outside of a rule.", code: "css-syntax", index: base + start };
      }
      const m = /^@([A-Za-z-]+)\s*(.*)$/s.exec(prelude);
      rules.push({ type: "at", name: m ? m[1].toLowerCase() : "", prelude: m ? m[2] : "", body: null, index: base + start });
      i = end + 1;
      continue;
    }
    // Find the matching close brace.
    let depth = 1;
    let j = end + 1;
    quote = null;
    for (; j < n; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) {
          quote = null;
        }
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    if (depth !== 0) {
      throw { message: "Unclosed block.", code: "css-syntax", index: base + end };
    }
    const body = text.slice(end + 1, j);
    const bodyIndex = base + end + 1;
    if (prelude.startsWith("@")) {
      const m = /^@([A-Za-z-]+)\s*(.*)$/s.exec(prelude);
      if (!m) {
        throw { message: "Malformed at-rule.", code: "css-syntax", index: base + start };
      }
      rules.push({ type: "at", name: m[1].toLowerCase(), prelude: m[2], body, bodyIndex, index: base + start });
    } else {
      rules.push({ type: "rule", prelude, body, bodyIndex, index: base + start });
    }
    i = j + 1;
  }
  return rules;
}

function splitTopLevel(text, sep) {
  const parts = [];
  let quote = null;
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
    } else if (c === sep && depth === 0) {
      parts.push({ text: text.slice(last, i), offset: last });
      last = i + 1;
    }
  }
  parts.push({ text: text.slice(last), offset: last });
  return parts;
}

/** Extract identifier-like tokens (ids, classes, tags, attribute values). */
function selectorTokens(selector) {
  return selector.match(/[A-Za-z_][A-Za-z0-9_-]*/g) || [];
}

const PROTECTED_SET = new Set(PROTECTED_TOKENS.map(t => t.toLowerCase()));
const PROTECTED_PREFIX_RE = new RegExp(`^(${PROTECTED_PREFIXES.join("|")})`, "i");
const CONTAINER_SET = new Set(CONTAINER_TOKENS.map(t => t.toLowerCase()));

/**
 * Classify one complex selector.
 *   "protected"  names security UI anywhere in the selector
 *   "container"  names an ancestor of security UI anywhere in the selector
 *   "broad"      rightmost compound has no id or class (could match anything)
 *   "normal"     everything else
 */
export function classifySelector(selector) {
  const tokens = selectorTokens(selector).map(t => t.toLowerCase());
  if (tokens.some(t => PROTECTED_SET.has(t) || PROTECTED_PREFIX_RE.test(t))) {
    return "protected";
  }
  // Attribute substring selectors can match protected ids without naming them.
  if (/\[\s*(id|class|anonid)\s*[*^$|~]?=/i.test(selector) || /\[\s*(id|class)\s*\]/i.test(selector)) {
    return "protected";
  }
  if (tokens.some(t => CONTAINER_SET.has(t)) || /(^|[\s>+~,(]):root\b/i.test(selector) || /\b(html|body|window)\b/i.test(selector.replace(/[#.][A-Za-z0-9_-]+/g, ""))) {
    return "container";
  }
  // Rightmost compound: text after the last top-level combinator.
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "(" || c === "[") {
      depth++;
    } else if (c === ")" || c === "]") {
      depth--;
    } else if (depth === 0 && (c === " " || c === ">" || c === "+" || c === "~")) {
      cut = i + 1;
    }
  }
  const subject = selector.slice(cut).replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "");
  if (!/[#.][A-Za-z_]/.test(subject)) {
    return "broad";
  }
  return "normal";
}

function checkUrlArg(arg) {
  let v = arg.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (DATA_IMAGE_RE.test(v)) {
    if (v.length > LIMITS.maxDataUrlBytes) {
      return "data: URL is too large";
    }
    return null;
  }
  if (CHROME_IMAGE_RE.test(v) && !v.includes("..")) {
    return null;
  }
  if (RELATIVE_ASSET_RE.test(v)) {
    return null;
  }
  return "only data:image/*, chrome://browser|global|branding images and relative asset paths inside the skill folder are allowed";
}

/** Returns an error string, or null if the value is acceptable. */
function checkValue(value) {
  const lower = value.toLowerCase();
  for (const fn of BANNED_FUNCTIONS) {
    // Match as a whole function name, not a suffix of another identifier.
    let from = 0;
    for (;;) {
      const at = lower.indexOf(fn, from);
      if (at === -1) {
        break;
      }
      if (at === 0 || !/[a-z0-9_-]/.test(lower[at - 1])) {
        return `function ${fn}) is not allowed`;
      }
      from = at + 1;
    }
  }
  // Validate and strip url(...) tokens.
  let rest = "";
  let i = 0;
  while (i < value.length) {
    const at = lower.indexOf("url(", i);
    if (at === -1) {
      rest += value.slice(i);
      break;
    }
    rest += value.slice(i, at);
    let j = at + 4;
    let quote = null;
    for (; j < value.length; j++) {
      const c = value[j];
      if (quote) {
        if (c === quote) {
          quote = null;
        }
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ")") {
        break;
      }
    }
    if (j >= value.length) {
      return "unterminated url()";
    }
    const err = checkUrlArg(value.slice(at + 4, j));
    if (err) {
      return `url(): ${err}`;
    }
    rest += " ";
    i = j + 1;
  }
  // Remaining strings must not smuggle a URL (several properties accept a
  // bare string where a URL is expected).
  const strings = rest.match(/"[^"]*"|'[^']*'/g) || [];
  for (const s of strings) {
    const inner = s.slice(1, -1).trim().toLowerCase();
    if (/^[a-z][a-z0-9+.-]*:/.test(inner) || inner.startsWith("//") || inner.includes("://")) {
      return "strings that look like URLs are not allowed";
    }
  }
  const bare = rest.replace(/"[^"]*"|'[^']*'/g, " ");
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(bare) || /(javascript|data|file|resource|about|moz-extension|https?|ftp|wss?|blob):/i.test(bare)) {
    return "URLs outside url() are not allowed";
  }
  return null;
}

/** Protected elements only accept opaque literal colours and plain keywords. */
function checkCosmeticValue(prop, value) {
  const v = value.trim().toLowerCase().replace(/\s*!important$/, "");
  if (/var\(|env\(|attr\(|calc\(|color-mix\(|light-dark\(|url\(/.test(v)) {
    return "only literal values are allowed on protected elements";
  }
  if (prop.endsWith("color")) {
    if (/^(transparent|currentcolor|inherit|initial|unset|revert|revert-layer)$/.test(v)) {
      return "colour must be an opaque literal on protected elements";
    }
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) {
      return null;
    }
    if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/.test(v)) {
      return "colours with an alpha channel are not allowed on protected elements";
    }
    if (/^(rgb|hsl)\(\s*[0-9.%]+(\s*,\s*|\s+)[0-9.%]+(\s*,\s*|\s+)[0-9.%]+\s*\)$/.test(v)) {
      return null;
    }
    if (/^[a-z]+$/.test(v)) {
      return null; // named colour (transparent already rejected)
    }
    return "unsupported colour syntax on protected elements (use #rrggbb, rgb() or a named colour)";
  }
  if (prop.includes("radius")) {
    return /^[0-9.]+(px|em|rem|%)?(\s+[0-9.]+(px|em|rem|%)?){0,3}$/.test(v) ? null : "radius must be a plain length";
  }
  if (prop === "font-weight") {
    return /^(normal|bold|[1-9]00)$/.test(v) ? null : "font-weight must be normal, bold or 100-900";
  }
  if (prop === "font-family") {
    return /^[a-z0-9 ,"'-]+$/.test(v) ? null : "font-family must be a plain list of names";
  }
  return null;
}

function riskyOnContainer(prop, value) {
  // Containers may be laid out, but not hidden, shrunk to nothing or moved away.
  if (!RISKY_PROPS.has(prop)) {
    return false;
  }
  const v = value.trim().toLowerCase().replace(/\s*!important$/, "");
  if (prop === "display") {
    return !/^(flex|grid|block|inline-flex|inline-block|-moz-box|flow-root)$/.test(v);
  }
  if (prop === "position") {
    return !/^(relative|static)$/.test(v);
  }
  if (prop === "overflow" || prop === "overflow-x" || prop === "overflow-y") {
    return !/^(visible|clip visible|visible clip)$/.test(v);
  }
  if (prop === "color-scheme") {
    return false;
  }
  if (prop === "transition") {
    return false;
  }
  if (prop === "appearance" || prop === "-moz-appearance" || prop === "-moz-default-appearance") {
    return false;
  }
  return true;
}

function parseLiteralColor(text) {
  const v = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    return [...m[1]].map(c => parseInt(c + c, 16));
  }
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) {
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  }
  m = /^rgb\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/.exec(v);
  if (m && m.slice(1).every(n => Number(n) <= 255)) {
    return m.slice(1).map(Number);
  }
  return null;
}

/** A token value: one literal colour, or light-dark(literal, literal). */
function parseTokenColors(value) {
  const v = value.trim().replace(/\s*!important$/i, "");
  const m = /^light-dark\((.*)\)$/is.exec(v);
  if (m) {
    const parts = splitTopLevel(m[1], ",").map(p => parseLiteralColor(p.text));
    return parts.length === 2 && parts.every(Boolean) ? parts : null;
  }
  const single = parseLiteralColor(v);
  return single ? [single, single] : null;
}

function relativeLuminance([r, g, b]) {
  const f = c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function validateTokenPairs(tokens, ctx) {
  for (const [bgName, fgName] of TOKEN_PAIRS) {
    const bg = tokens.get(bgName);
    const fg = tokens.get(fgName);
    if (!bg && !fg) {
      continue;
    }
    if (!bg || !fg) {
      const present = bg || fg;
      ctx.err("css-token-pair", `${bgName} and ${fgName} must be set together in the same rule, so their contrast can be checked.`, present.at);
      continue;
    }
    const bgColors = parseTokenColors(bg.value);
    const fgColors = parseTokenColors(fg.value);
    if (!bgColors || !fgColors) {
      ctx.err("css-token-pair", `${bgName} and ${fgName} must be literal colours (#rrggbb or rgb()), or light-dark() of two literals.`, (bgColors ? fg : bg).at);
      continue;
    }
    for (let i = 0; i < 2; i++) {
      const ratio = contrastRatio(bgColors[i], fgColors[i]);
      if (ratio < MIN_PAIR_CONTRAST) {
        ctx.err("css-token-contrast", `${fgName} on ${bgName} has a contrast ratio of ${ratio.toFixed(2)}; at least ${MIN_PAIR_CONTRAST} is required so text stays readable.`, fg.at);
        break;
      }
    }
  }
}

function validateDeclarations(body, bodyIndex, selectorClass, ctx) {
  if (body.includes("{") || body.includes("}")) {
    ctx.err("css-nesting", "Nested rules are not supported in skill CSS.", bodyIndex);
    return;
  }
  const tokens = new Map();
  for (const part of splitTopLevel(body, ";")) {
    const decl = part.text.trim();
    if (!decl) {
      continue;
    }
    const at = bodyIndex + part.offset;
    const colon = decl.indexOf(":");
    if (colon === -1) {
      ctx.err("css-syntax", `Malformed declaration "${decl.slice(0, 40)}".`, at);
      continue;
    }
    const rawProp = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (!/^(--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z-]*)$/.test(rawProp)) {
      ctx.err("css-syntax", `Invalid property name "${rawProp.slice(0, 40)}".`, at);
      continue;
    }
    const isCustom = rawProp.startsWith("--");
    const prop = isCustom ? rawProp : rawProp.toLowerCase();
    if (!value) {
      ctx.err("css-syntax", `Empty value for "${prop}".`, at);
      continue;
    }
    if (isCustom && !KNOWN_TOKENS.includes(prop) && !/^--my-[A-Za-z0-9_-]+$/.test(prop)) {
      ctx.err(
        "css-custom-property",
        prop.startsWith("--skein-")
          ? `Unknown Skein token "${prop}". Known tokens: ${KNOWN_TOKENS.join(", ")}.`
          : `"${prop}" is one of the browser's own variables. Use a --skein-* token, or name private variables --my-*.`,
        at
      );
      continue;
    }
    if (isCustom && KNOWN_TOKENS.includes(prop)) {
      tokens.set(prop, { value, at });
    }
    if (BANNED_PROPS.has(prop)) {
      ctx.err("css-banned-property", `Property "${prop}" is not allowed.`, at);
      continue;
    }
    const valueError = checkValue(value);
    if (valueError) {
      ctx.err("css-value", `${prop}: ${valueError}.`, at);
      continue;
    }
    if (selectorClass === "protected") {
      if (isCustom || !COSMETIC_PROPS.has(prop)) {
        ctx.err(
          "css-protected",
          `"${prop}" may not be set on security UI (address bar, site identity, permission, download and dialog surfaces). Allowed: ${[...COSMETIC_PROPS].slice(0, 5).join(", ")}, ...`,
          at
        );
        continue;
      }
      const cosmeticError = checkCosmeticValue(prop, value);
      if (cosmeticError) {
        ctx.err("css-protected", `${prop}: ${cosmeticError}.`, at);
      }
    } else if (selectorClass === "container") {
      if (riskyOnContainer(prop, value)) {
        ctx.err(
          "css-container",
          `"${prop}: ${value.slice(0, 40)}" could hide or displace a region that contains security UI. Use layout.json to move regions.`,
          at
        );
      }
    } else if (selectorClass === "broad") {
      if (RISKY_PROPS.has(prop) && prop !== "transition" && prop !== "color-scheme") {
        ctx.err(
          "css-broad",
          `"${prop}" needs a selector whose last part names an id or class; this selector could match security UI.`,
          at
        );
      }
    }
  }
  validateTokenPairs(tokens, ctx);
}

const CLASS_RANK = { normal: 0, broad: 1, container: 2, protected: 3 };

function validateRuleList(rules, ctx, inKeyframes) {
  for (const rule of rules) {
    if (rule.type === "at") {
      if (!ALLOWED_AT_RULES.has(rule.name)) {
        ctx.err("css-at-rule", `@${rule.name} is not allowed in skill CSS.`, rule.index);
        continue;
      }
      if (rule.body === null) {
        if (rule.name !== "layer") {
          ctx.err("css-at-rule", `@${rule.name} needs a block.`, rule.index);
        }
        continue;
      }
      const preludeError = checkValue(rule.prelude);
      if (preludeError) {
        ctx.err("css-value", `@${rule.name}: ${preludeError}.`, rule.index);
        continue;
      }
      if (rule.name === "font-face") {
        validateDeclarations(rule.body, rule.bodyIndex, "normal", ctx);
      } else if (rule.name === "keyframes") {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(rule.prelude.trim())) {
          ctx.err("css-syntax", "Invalid @keyframes name.", rule.index);
          continue;
        }
        let inner;
        try {
          inner = parseRules(rule.body, rule.bodyIndex);
        } catch (e) {
          ctx.err(e.code, e.message, e.index);
          continue;
        }
        validateRuleList(inner, ctx, true);
      } else {
        let inner;
        try {
          inner = parseRules(rule.body, rule.bodyIndex);
        } catch (e) {
          ctx.err(e.code, e.message, e.index);
          continue;
        }
        validateRuleList(inner, ctx, inKeyframes);
      }
      continue;
    }
    if (inKeyframes) {
      // Keyframe selectors are percentages; which element they animate is
      // unknown here, so treat the block as if it targeted a container:
      // animations may not drive hiding properties.
      if (!/^((from|to|[0-9.]+%)\s*,?\s*)+$/.test(rule.prelude)) {
        ctx.err("css-syntax", "Invalid keyframe selector.", rule.index);
        continue;
      }
      validateDeclarations(rule.body, rule.bodyIndex, "broad", ctx);
      continue;
    }
    if (!rule.prelude) {
      ctx.err("css-syntax", "Rule has no selector.", rule.index);
      continue;
    }
    if (/["']/.test(rule.prelude.replace(/\[[^\]]*\]/g, ""))) {
      ctx.err("css-syntax", "Strings are only allowed inside attribute selectors.", rule.index);
      continue;
    }
    if (/::?(-moz-)?(before|after|backdrop|marker|placeholder|selection)/i.test(rule.prelude) && /\bcontent\s*:/i.test(rule.body)) {
      // Generated text is allowed, but never on or inside security UI.
      const cls = splitTopLevel(rule.prelude, ",").map(p => classifySelector(p.text.trim()));
      if (cls.some(c => c === "protected" || c === "container")) {
        ctx.err("css-protected", "Generated content is not allowed on security UI or its containers.", rule.index);
        continue;
      }
    }
    let worst = "normal";
    for (const part of splitTopLevel(rule.prelude, ",")) {
      const sel = part.text.trim();
      if (!sel) {
        ctx.err("css-syntax", "Empty selector in list.", rule.index);
        continue;
      }
      const cls = classifySelector(sel);
      if (CLASS_RANK[cls] > CLASS_RANK[worst]) {
        worst = cls;
      }
    }
    validateDeclarations(rule.body, rule.bodyIndex, worst, ctx);
  }
}

/**
 * Validate one skill stylesheet.
 * @returns {{ok: boolean, errors: Array<{code, message, line}>}}
 */
export function validateCss(css) {
  const errors = [];
  if (typeof css !== "string") {
    return { ok: false, errors: [{ code: "css-type", message: "CSS must be text.", line: 1 }] };
  }
  if (css.length > LIMITS.maxFileBytes) {
    return { ok: false, errors: [{ code: "too-large", message: "Stylesheet is too large.", line: 1 }] };
  }
  const pre = preprocessCss(css);
  if (pre.error) {
    return { ok: false, errors: [{ code: pre.code, message: pre.error, line: lineOf(css, pre.index) }] };
  }
  const ctx = {
    err(code, message, index) {
      errors.push({ code, message, line: lineOf(css, index) });
    },
  };
  let rules;
  try {
    rules = parseRules(pre.text, 0);
  } catch (e) {
    return { ok: false, errors: [{ code: e.code, message: e.message, line: lineOf(css, e.index) }] };
  }
  validateRuleList(rules, ctx, false);
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------------ */
/* JSON files                                                               */
/* ------------------------------------------------------------------------ */

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseJson(text, errors, file) {
  if (text.length > LIMITS.maxFileBytes) {
    errors.push({ file, code: "too-large", message: "File is too large." });
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    errors.push({ file, code: "json", message: `Invalid JSON: ${e.message}` });
    return undefined;
  }
}

function checkAgainst(spec, value) {
  if (spec === "boolean") {
    return typeof value === "boolean";
  }
  if (spec instanceof RegExp) {
    return typeof value === "string" && spec.test(value);
  }
  if (Array.isArray(spec)) {
    if (spec.length === 2 && typeof spec[0] === "number" && typeof spec[1] === "number") {
      // A two-number spec is an inclusive integer range.
      return Number.isInteger(value) && value >= spec[0] && value <= spec[1];
    }
    return spec.includes(value);
  }
  return false;
}

export function validatePrefs(obj) {
  const errors = [];
  const prefs = {};
  if (!isPlainObject(obj) || !isPlainObject(obj.prefs)) {
    return { errors: [{ code: "prefs-shape", message: 'prefs.json must be {"prefs": {...}}.' }], prefs };
  }
  for (const key of Object.keys(obj)) {
    if (key !== "prefs") {
      errors.push({ code: "prefs-shape", message: `Unknown key "${key}".` });
    }
  }
  for (const [name, value] of Object.entries(obj.prefs)) {
    if (!Object.hasOwn(ALLOWED_PREFS, name)) {
      errors.push({ code: "prefs-not-allowed", message: `Preference "${name}" is not on the interface allowlist.` });
      continue;
    }
    if (!checkAgainst(ALLOWED_PREFS[name], value)) {
      errors.push({ code: "prefs-value", message: `Invalid value for "${name}".` });
      continue;
    }
    prefs[name] = value;
  }
  return { errors, prefs };
}

export function validateLayout(obj) {
  const errors = [];
  const layout = {};
  if (!isPlainObject(obj)) {
    return { errors: [{ code: "layout-shape", message: "layout.json must be an object." }], layout };
  }
  for (const [key, value] of Object.entries(obj)) {
    if (!Object.hasOwn(LAYOUT_SCHEMA, key)) {
      errors.push({ code: "layout-unknown", message: `Unknown layout key "${key}".` });
      continue;
    }
    const spec = LAYOUT_SCHEMA[key];
    if (Array.isArray(spec) || typeof spec === "string") {
      if (!checkAgainst(spec, value)) {
        errors.push({ code: "layout-value", message: `Invalid value for "${key}".` });
      } else {
        layout[key] = value;
      }
      continue;
    }
    if (!isPlainObject(value)) {
      errors.push({ code: "layout-value", message: `"${key}" must be an object.` });
      continue;
    }
    layout[key] = {};
    for (const [sub, subValue] of Object.entries(value)) {
      if (!Object.hasOwn(spec, sub)) {
        errors.push({ code: "layout-unknown", message: `Unknown layout key "${key}.${sub}".` });
      } else if (!checkAgainst(spec[sub], subValue)) {
        errors.push({ code: "layout-value", message: `Invalid value for "${key}.${sub}".` });
      } else {
        layout[key][sub] = subValue;
      }
    }
  }
  return { errors, layout };
}

export function validateKeybindings(obj) {
  const errors = [];
  const bindings = [];
  if (!isPlainObject(obj) || !Array.isArray(obj.bindings)) {
    return { errors: [{ code: "keys-shape", message: 'keybindings.json must be {"bindings": [...]}.' }], bindings };
  }
  if (obj.bindings.length > LIMITS.maxKeybindings) {
    return { errors: [{ code: "keys-shape", message: "Too many keybindings." }], bindings };
  }
  const seen = new Set();
  for (const b of obj.bindings) {
    if (!isPlainObject(b) || typeof b.command !== "string" || typeof b.key !== "string") {
      errors.push({ code: "keys-shape", message: "Each binding needs a command and a key." });
      continue;
    }
    if (!ALLOWED_COMMANDS.has(b.command)) {
      errors.push({ code: "keys-command", message: `Command "${b.command}" is not bindable.` });
      continue;
    }
    if (!KEY_RE.test(b.key)) {
      errors.push({ code: "keys-key", message: `Unsupported key "${b.key}".` });
      continue;
    }
    const modifiers = b.modifiers === undefined ? [] : b.modifiers;
    if (!Array.isArray(modifiers) || modifiers.some(m => !ALLOWED_MODIFIERS.has(m))) {
      errors.push({ code: "keys-modifiers", message: `Invalid modifiers for "${b.command}".` });
      continue;
    }
    const nonShift = modifiers.filter(m => m !== "shift");
    if (!nonShift.length && !/^F[0-9]+$/.test(b.key)) {
      errors.push({
        code: "keys-modifiers",
        message: `"${b.command}": a binding needs accel, alt, control or meta (plain keys would swallow typing).`,
      });
      continue;
    }
    const sig = [...new Set(modifiers)].sort().join("+") + "+" + b.key.toLowerCase();
    if (seen.has(sig)) {
      errors.push({ code: "keys-duplicate", message: `Duplicate binding ${sig}.` });
      continue;
    }
    seen.add(sig);
    bindings.push({ command: b.command, key: b.key, modifiers: [...new Set(modifiers)].sort() });
  }
  return { errors, bindings };
}

function validateSkillManifest(obj, id) {
  const errors = [];
  if (!isPlainObject(obj)) {
    return { errors: [{ code: "skill-shape", message: "skill.json must be an object." }] };
  }
  const allowed = new Set(["id", "name", "description", "author", "version", "touches"]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push({ code: "skill-shape", message: `Unknown key "${key}" in skill.json.` });
    }
  }
  if (obj.id !== id) {
    errors.push({ code: "skill-id", message: `skill.json "id" must equal the folder name "${id}".` });
  }
  for (const key of ["name", "description", "author", "version"]) {
    if (obj[key] !== undefined && (typeof obj[key] !== "string" || obj[key].length > 500)) {
      errors.push({ code: "skill-shape", message: `"${key}" must be a short string.` });
    }
  }
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    errors.push({ code: "skill-shape", message: 'skill.json needs a "name".' });
  }
  if (!Array.isArray(obj.touches) || !obj.touches.length || obj.touches.some(t => !TOUCHES.includes(t))) {
    errors.push({
      code: "skill-touches",
      message: `"touches" must be a non-empty list drawn from: ${TOUCHES.join(", ")}.`,
    });
  }
  return { errors };
}

function mergeLayout(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (isPlainObject(v)) {
      into[k] = { ...(into[k] || {}), ...v };
    } else {
      into[k] = v;
    }
  }
}

/**
 * Validate a whole customization folder.
 *
 * @param {Map<string,string>|Object} files  relative path (forward slashes) to
 *        text content. Only regular files; the caller refuses symlinks.
 * @param {object} [options]
 * @param {string} [options.space]  active space name, for per-space skill sets
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{file, code, message, line?}>,
 *   warnings: Array<{file, code, message}>,
 *   resolved: {enabled: string[], css: Array<{id, css}>, layout: object,
 *              prefs: object, keybindings: Array, skills: object}
 * }}
 */
export function validateBundle(files, options = {}) {
  const map = files instanceof Map ? files : new Map(Object.entries(files));
  const errors = [];
  const warnings = [];
  const resolved = { enabled: [], css: [], layout: {}, prefs: {}, keybindings: [], skills: {} };
  const fail = () => ({ ok: false, errors, warnings, resolved: { enabled: [], css: [], layout: {}, prefs: {}, keybindings: [], skills: {} } });

  for (const path of map.keys()) {
    if (path.includes("\\") || path.startsWith("/") || path.split("/").includes("..")) {
      errors.push({ file: path, code: "path", message: "Illegal path." });
    }
  }
  if (errors.length) {
    return fail();
  }

  if (!map.has("skein.json")) {
    // An empty folder is valid: nothing is applied.
    return { ok: true, errors, warnings, resolved };
  }
  const root = parseJson(map.get("skein.json"), errors, "skein.json");
  if (root === undefined) {
    return fail();
  }
  if (!isPlainObject(root) || root.formatVersion !== FORMAT_VERSION) {
    errors.push({ file: "skein.json", code: "root-version", message: `skein.json needs "formatVersion": ${FORMAT_VERSION}.` });
    return fail();
  }
  for (const key of Object.keys(root)) {
    if (!["formatVersion", "enabled", "spaces"].includes(key)) {
      errors.push({ file: "skein.json", code: "root-shape", message: `Unknown key "${key}".` });
    }
  }
  const checkIdList = (list, where) => {
    if (!Array.isArray(list) || list.some(id => typeof id !== "string" || !SKILL_ID_RE.test(id))) {
      errors.push({ file: "skein.json", code: "root-shape", message: `${where} must be a list of skill ids (lowercase letters, digits, hyphens).` });
      return [];
    }
    if (new Set(list).size !== list.length) {
      errors.push({ file: "skein.json", code: "root-shape", message: `${where} lists a skill twice.` });
    }
    if (list.length > LIMITS.maxSkills) {
      errors.push({ file: "skein.json", code: "root-shape", message: `${where} lists too many skills.` });
      return [];
    }
    return list;
  };
  let enabled = checkIdList(root.enabled === undefined ? [] : root.enabled, '"enabled"');
  if (root.spaces !== undefined) {
    if (!isPlainObject(root.spaces)) {
      errors.push({ file: "skein.json", code: "root-shape", message: '"spaces" must be an object keyed by space name.' });
    } else {
      for (const [space, cfg] of Object.entries(root.spaces)) {
        if (space.length > 64 || !isPlainObject(cfg) || Object.keys(cfg).some(k => k !== "enabled")) {
          errors.push({ file: "skein.json", code: "root-shape", message: `spaces["${space.slice(0, 64)}"] must be {"enabled": [...]}.` });
          continue;
        }
        const list = checkIdList(cfg.enabled === undefined ? [] : cfg.enabled, `spaces["${space}"].enabled`);
        if (options.space !== undefined && space === options.space) {
          // Per-space skills layer on top of the global ones.
          enabled = [...enabled, ...list.filter(id => !enabled.includes(id))];
        }
      }
    }
  }
  if (errors.length) {
    return fail();
  }

  for (const id of enabled) {
    const dir = `skills/${id}/`;
    const manifestPath = `${dir}skill.json`;
    if (!map.has(manifestPath)) {
      errors.push({ file: manifestPath, code: "skill-missing", message: `Enabled skill "${id}" has no skill.json.` });
      continue;
    }
    const manifest = parseJson(map.get(manifestPath), errors, manifestPath);
    if (manifest === undefined) {
      continue;
    }
    const m = validateSkillManifest(manifest, id);
    for (const e of m.errors) {
      errors.push({ file: manifestPath, ...e });
    }
    if (m.errors.length) {
      continue;
    }
    const touches = new Set(manifest.touches);
    // A skill must declare everything it ships: undeclared files are an error.
    for (const [kind, name] of Object.entries(SKILL_FILES)) {
      const present = map.has(dir + name);
      if (present && !touches.has(kind)) {
        errors.push({ file: dir + name, code: "skill-undeclared", message: `"${name}" is present but "${kind}" is not in "touches".` });
      } else if (!present && touches.has(kind)) {
        errors.push({ file: dir + name, code: "skill-missing-file", message: `"touches" lists "${kind}" but "${name}" is missing.` });
      }
    }
    for (const path of map.keys()) {
      if (!path.startsWith(dir)) {
        continue;
      }
      const rel = path.slice(dir.length);
      if (rel === "skill.json" || Object.values(SKILL_FILES).includes(rel) || rel === "README.md") {
        continue;
      }
      if (/^assets\/[A-Za-z0-9_][A-Za-z0-9_./-]*\.(svg|png|gif|webp|jpg|jpeg|woff2)$/.test(rel)) {
        continue;
      }
      errors.push({ file: path, code: "skill-unknown-file", message: "Unexpected file in skill folder (assets go in assets/, images and woff2 only)." });
    }

    const skill = { manifest: { ...manifest }, touches: [...touches] };
    if (touches.has("css") && map.has(dir + SKILL_FILES.css)) {
      const css = map.get(dir + SKILL_FILES.css);
      const res = validateCss(css);
      for (const e of res.errors) {
        errors.push({ file: dir + SKILL_FILES.css, ...e });
      }
      if (res.ok) {
        // Relative assets must exist inside this skill's assets/ folder.
        const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
        let um;
        let assetsOk = true;
        while ((um = urlRe.exec(css))) {
          const ref = um[1].trim();
          if (/^(data:|chrome:)/i.test(ref)) {
            continue;
          }
          if (!ref.startsWith("assets/") || !map.has(dir + ref)) {
            assetsOk = false;
            errors.push({ file: dir + SKILL_FILES.css, code: "css-asset", message: `Asset "${ref}" must be a file under ${dir}assets/.`, line: lineOf(css, um.index) });
          }
        }
        if (assetsOk) {
          resolved.css.push({ id, css });
          skill.css = css;
        }
      }
    }
    if (touches.has("layout") && map.has(dir + SKILL_FILES.layout)) {
      const obj = parseJson(map.get(dir + SKILL_FILES.layout), errors, dir + SKILL_FILES.layout);
      if (obj !== undefined) {
        const res = validateLayout(obj);
        for (const e of res.errors) {
          errors.push({ file: dir + SKILL_FILES.layout, ...e });
        }
        mergeLayout(resolved.layout, res.layout);
        skill.layout = res.layout;
      }
    }
    if (touches.has("prefs") && map.has(dir + SKILL_FILES.prefs)) {
      const obj = parseJson(map.get(dir + SKILL_FILES.prefs), errors, dir + SKILL_FILES.prefs);
      if (obj !== undefined) {
        const res = validatePrefs(obj);
        for (const e of res.errors) {
          errors.push({ file: dir + SKILL_FILES.prefs, ...e });
        }
        Object.assign(resolved.prefs, res.prefs);
        skill.prefs = res.prefs;
      }
    }
    if (touches.has("keybindings") && map.has(dir + SKILL_FILES.keybindings)) {
      const obj = parseJson(map.get(dir + SKILL_FILES.keybindings), errors, dir + SKILL_FILES.keybindings);
      if (obj !== undefined) {
        const res = validateKeybindings(obj);
        for (const e of res.errors) {
          errors.push({ file: dir + SKILL_FILES.keybindings, ...e });
        }
        resolved.keybindings.push(...res.bindings);
        skill.keybindings = res.bindings;
      }
    }
    resolved.skills[id] = skill;
  }

  // Skills on disk that are not enabled are fine, but worth surfacing.
  const onDisk = new Set();
  for (const path of map.keys()) {
    const m = /^skills\/([^/]+)\//.exec(path);
    if (m) {
      onDisk.add(m[1]);
    } else if (!["skein.json", "SKILL.md", "README.md", ".status.json"].includes(path) && !path.startsWith("docs/")) {
      warnings.push({ file: path, code: "unknown-file", message: "File is ignored by Skein." });
    }
  }
  for (const id of onDisk) {
    if (!enabled.includes(id)) {
      warnings.push({ file: `skills/${id}/`, code: "skill-disabled", message: `Skill "${id}" is installed but not enabled.` });
    }
  }

  if (errors.length) {
    // All or nothing: a bundle with any error applies nothing.
    return fail();
  }
  resolved.enabled = enabled;
  return { ok: true, errors, warnings, resolved };
}
