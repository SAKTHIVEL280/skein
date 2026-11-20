/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Focus features modelled on Zen Browser:
 *  - compact mode: sidebar and toolbar hide and slide back in at the edges
 *  - floating new-tab bar: Ctrl+T and the new-tab button open a centered
 *    search field; what you type becomes the new tab
 *  - shortcuts (Ctrl+Alt+C compact, Ctrl+Alt+B sidebar); Ctrl+Tab switching
 *    in recently-used order is a default pref (firefox-branding.js)
 */

const PREF_COMPACT = "skein.focus.compact";
const PREF_FLOATING = "skein.focus.floatingNewTab";
const PREF_HIDE_SIDEBAR = "skein.focus.sidebarHidden";

const NEW_TAB_COMMANDS = new Set(["cmd_newNavigatorTab", "cmd_newNavigatorTabNoEvent"]);

function syncRootAttrs(win) {
  const root = win.document.documentElement;
  root.toggleAttribute("skein-compact", Services.prefs.getBoolPref(PREF_COMPACT, false));
  root.toggleAttribute("skein-sidebar-hidden", Services.prefs.getBoolPref(PREF_HIDE_SIDEBAR, false));
}

function togglePref(name) {
  Services.prefs.setBoolPref(name, !Services.prefs.getBoolPref(name, false));
}

export const SkeinFocus = {
  _observing: false,

  browserWindowDelayedStartup(win) {
    if (!this._observing) {
      this._observing = true;
      const refresh = () => {
        for (const w of Services.wm.getEnumerator("navigator:browser")) {
          syncRootAttrs(w);
        }
      };
      Services.prefs.addObserver(PREF_COMPACT, refresh);
      Services.prefs.addObserver(PREF_HIDE_SIDEBAR, refresh);
    }
    syncRootAttrs(win);
    win.addEventListener("command", e => this._onCommand(win, e), true);
    win.addEventListener("keydown", e => this._onKey(win, e), true);
  },

  _onCommand(win, e) {
    if (!NEW_TAB_COMMANDS.has(e.target?.id) || !Services.prefs.getBoolPref(PREF_FLOATING, true)) {
      return;
    }
    if (win.document.documentElement.hasAttribute("inFullscreen") || win.PrivateBrowsingUtils?.isWindowPrivate(win)) {
      return;
    }
    e.stopImmediatePropagation();
    e.preventDefault();
    this.showBar(win);
  },

  _onKey(win, e) {
    const accel = e.ctrlKey || e.metaKey;
    if (accel && e.altKey && !e.shiftKey) {
      if (e.code === "KeyC") {
        togglePref(PREF_COMPACT);
      } else if (e.code === "KeyB") {
        togglePref(PREF_HIDE_SIDEBAR);
      } else {
        return;
      }
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  },

  _ensureBar(win) {
    const doc = win.document;
    let bar = doc.getElementById("skein-newtab-bar");
    if (bar) {
      return bar;
    }
    const H = tag => doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    bar = H("div");
    bar.id = "skein-newtab-bar";
    bar.hidden = true;
    const box = H("div");
    box.className = "skein-newtab-box";
    const input = H("input");
    input.type = "text";
    input.placeholder = "Search or enter address";
    input.setAttribute("aria-label", "Open a new tab");
    const hint = H("div");
    hint.className = "skein-newtab-hint";
    hint.textContent = "Enter opens a new tab · Esc cancels";
    box.append(input, hint);
    bar.append(box);
    bar.addEventListener("mousedown", e => {
      if (e.target === bar) {
        this.hideBar(win);
      }
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.hideBar(win);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this._open(win, input.value);
      }
    });
    doc.documentElement.append(bar);
    return bar;
  },

  showBar(win) {
    const bar = this._ensureBar(win);
    const input = bar.querySelector("input");
    input.value = "";
    bar.hidden = false;
    win.requestAnimationFrame(() => input.focus());
  },

  hideBar(win) {
    const bar = win.document.getElementById("skein-newtab-bar");
    if (bar) {
      bar.hidden = true;
    }
  },

  _open(win, text) {
    this.hideBar(win);
    text = text.trim();
    let url = null;
    if (text) {
      try {
        const info = Services.uriFixup.getFixupURIInfo(
          text,
          Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS | Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP
        );
        url = info.preferredURI?.spec || null;
      } catch (e) {
        url = null;
      }
    }
    win.BrowserCommands.openTab(url ? { url } : {});
  },
};
