/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Focus features modelled on Zen Browser:
 *  - compact mode: sidebar and toolbar hide and slide back in at the edges
 *  - floating new-tab bar: Ctrl+T and the new-tab button float the real
 *    address bar over the page; what you pick opens in a new tab
 *  - sidebar toolbar: with vertical tabs the navigation toolbar lives at the
 *    top of the sidebar and the top of the window only holds bookmarks
 *    (skein.ui.topSearchBar restores the classic top bar)
 *  - empty state: closing the last tab shows a blank home page instead of a
 *    stray "New Tab" entry in the sidebar
 *  - Glance: open a link in a floating card from the link context menu;
 *    "Open as tab" keeps it, Esc or Close returns to the page
 *  - shortcuts (Ctrl+Alt+C compact, Ctrl+Alt+B sidebar, Ctrl+Alt+V split); Ctrl+Tab switching
 *    in recently-used order is a default pref (firefox-branding.js)
 */

const PREF_COMPACT = "skein.focus.compact";
const PREF_FLOATING = "skein.focus.floatingNewTab";
const PREF_HIDE_SIDEBAR = "skein.focus.sidebarHidden";

const PREF_TOP_BAR = "skein.ui.topSearchBar";
const PREF_VERTICAL = "sidebar.verticalTabs";
const EMPTY_URL = "chrome://browser/content/skein/empty.html";

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
      const relayout = () => {
        for (const w of Services.wm.getEnumerator("navigator:browser")) {
          this._layout(w);
        }
      };
      Services.prefs.addObserver(PREF_TOP_BAR, relayout);
      Services.prefs.addObserver(PREF_VERTICAL, () => Services.tm.dispatchToMainThread(relayout));
    }
    this._adoptExpandOnHover();
    syncRootAttrs(win);
    this._initGlance(win);
    this._initLayout(win);
    this._initEmptyState(win);
    this._emptyOnStartup(win);
    this._initTopBar(win);
    if (!Services.prefs.getBoolPref("skein.focus.toolbarOrder", false)) {
      Services.prefs.setBoolPref("skein.focus.toolbarOrder", true);
      const CUI = win.CustomizableUI;
      ["sidebar-button", "back-button", "forward-button", "stop-reload-button"].forEach((id, i) => {
        try {
          if (CUI.getPlacementOfWidget(id)?.area === CUI.AREA_NAVBAR) {
            CUI.moveWidgetWithinArea(id, i);
          } else {
            CUI.addWidgetToArea(id, CUI.AREA_NAVBAR, i);
          }
        } catch (e) {
          console.error(`Skein: placing ${id} failed`, e);
        }
      });
    }
    win.addEventListener("command", e => this._onCommand(win, e), true);
    win.addEventListener("keydown", e => this._onKey(win, e), true);
  },

  /**
   * Firefox's own "expand on hover" collapses the sidebar to icons and fights
   * Skein's hover reveal. In the Zen layout, Skein's hidden-until-hover
   * sidebar does that job, so the setting is translated into it.
   */
  _adoptExpandOnHover() {
    const convert = () => {
      if (Services.prefs.getBoolPref("skein.ui.zen", true) && Services.prefs.getStringPref("sidebar.visibility", "") === "expand-on-hover") {
        Services.prefs.setStringPref("sidebar.visibility", "always-show");
        Services.prefs.setBoolPref(PREF_HIDE_SIDEBAR, true);
      }
    };
    if (!this._watchingVisibility) {
      this._watchingVisibility = true;
      Services.prefs.addObserver("sidebar.visibility", () => Services.tm.dispatchToMainThread(convert));
    }
    convert();
  },

  _initGlance(win) {
    const doc = win.document;
    const menu = doc.getElementById("contentAreaContextMenu");
    const anchor = doc.getElementById("context-openlinkintab");
    if (!menu || !anchor) {
      return;
    }
    const item = doc.createXULElement("menuitem");
    item.id = "skein-context-glance";
    item.setAttribute("label", "Open in Glance");
    item.setAttribute("accesskey", "G");
    item.addEventListener("command", () => {
      const ctx = win.gContextMenu;
      if (ctx?.linkURL) {
        this.openGlance(win, ctx.linkURL, ctx.principal);
      }
    });
    anchor.after(item);
    menu.addEventListener("popupshowing", e => {
      if (e.target === menu) {
        item.hidden = !win.gContextMenu?.onLink || win.gContextMenu.onMailtoLink;
      }
    });
    win.gBrowser.tabContainer.addEventListener("TabSelect", e => {
      const prev = e.detail?.previousTab;
      if (prev?.hasAttribute("skein-glance") && e.target !== prev) {
        win.gBrowser.removeTab(prev, { animate: false });
      }
      this._syncGlance(win);
    });
  },

  openGlance(win, url, principal) {
    const gBrowser = win.gBrowser;
    const opener = gBrowser.selectedTab;
    const tab = gBrowser.addTab(url, {
      triggeringPrincipal: principal || Services.scriptSecurityManager.createNullPrincipal({}),
      relatedToCurrent: true,
      skipAnimation: true,
    });
    tab.setAttribute("skein-glance", "true");
    tab._skeinGlanceOpener = opener;
    gBrowser.selectedTab = tab;
    this._syncGlance(win);
  },

  closeGlance(win, keep = false) {
    const gBrowser = win.gBrowser;
    const tab = gBrowser.selectedTab;
    if (!tab.hasAttribute("skein-glance")) {
      return;
    }
    if (keep) {
      tab.removeAttribute("skein-glance");
      this._syncGlance(win);
      return;
    }
    const opener = tab._skeinGlanceOpener;
    if (opener && !opener.closing && opener.isConnected) {
      gBrowser.selectedTab = opener;
    } else {
      gBrowser.removeTab(tab, { animate: false });
    }
  },

  _syncGlance(win) {
    const doc = win.document;
    const open = win.gBrowser.selectedTab.hasAttribute("skein-glance");
    doc.documentElement.toggleAttribute("skein-glance-open", open);
    for (const t of win.gBrowser.tabs) {
      t.toggleAttribute("skein-glance-opener", open && t === win.gBrowser.selectedTab._skeinGlanceOpener);
    }
    let bar = doc.getElementById("skein-glance-bar");
    if (open && !bar) {
      const H = tag => doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
      bar = H("div");
      bar.id = "skein-glance-bar";
      const expand = H("button");
      expand.textContent = "Open as tab";
      expand.addEventListener("click", () => this.closeGlance(win, true));
      const close = H("button");
      close.textContent = "Close";
      close.title = "Close (Esc)";
      close.addEventListener("click", () => this.closeGlance(win));
      bar.append(expand, close);
      doc.documentElement.append(bar);
    }
    if (bar) {
      bar.hidden = !open;
    }
  },

  _initLayout(win) {
    const navbar = win.document.getElementById("nav-bar");
    win._skeinNavbarHome = { parent: navbar.parentNode, next: navbar.nextElementSibling };
    win.addEventListener("beforecustomization", () => this._layout(win, true));
    win.addEventListener("aftercustomization", () => this._layout(win));
    this._layout(win);
  },

  _layout(win, forceTop = false) {
    const doc = win.document;
    const navbar = doc.getElementById("nav-bar");
    const container = doc.getElementById("sidebar-container");
    const home = win._skeinNavbarHome;
    if (!navbar || !container || !home) {
      return;
    }
    const inSidebar =
      !forceTop &&
      Services.prefs.getBoolPref(PREF_VERTICAL, false) &&
      !Services.prefs.getBoolPref(PREF_TOP_BAR, false) &&
      Services.prefs.getBoolPref("skein.ui.zen", true);
    if (inSidebar && navbar.parentNode !== container) {
      container.prepend(navbar);
    } else if (!inSidebar && navbar.parentNode !== home.parent) {
      home.parent.insertBefore(navbar, home.next);
    }
    doc.documentElement.toggleAttribute("skein-sidebar-toolbar", inSidebar);
    if (!win._skeinWidthObserver) {
      const root = doc.documentElement;
      win._skeinWidthObserver = new win.ResizeObserver(entries => {
        const w = Math.round(entries[0].borderBoxSize?.[0]?.inlineSize || entries[0].target.getBoundingClientRect().width);
        if (w > 40) {
          root.style.setProperty("--skein-sidebar-w", `${w}px`);
        }
      });
    }
    win._skeinWidthObserver.disconnect();
    win._skeinWidthObserver.observe(inSidebar ? container : doc.querySelector("sidebar-main") || container);
  },

  /**
   * Top bar, like Zen's: hidden until the pointer reaches the top edge of the
   * window. It is a drag handle for the window and holds the window buttons,
   * which tiling desktops (Hyprland) and the sidebar layout otherwise lack.
   */
  _initTopBar(win) {
    const doc = win.document;
    const H = tag => doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
    const bar = H("div");
    bar.id = "skein-topbar";
    const drag = H("div");
    drag.className = "skein-topbar-drag";
    drag.addEventListener("dblclick", () => toggleMaximize());
    const buttons = H("div");
    buttons.className = "skein-topbar-buttons";
    const toggleMaximize = () => (win.windowState === win.STATE_MAXIMIZED ? win.restore() : win.maximize());
    const add = (cls, label, fn) => {
      const b = H("button");
      b.className = cls;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", fn);
      buttons.append(b);
    };
    add("skein-win-min", "Minimize", () => win.minimize());
    add("skein-win-max", "Maximize", toggleMaximize);
    add("skein-win-close", "Close window", e => win.BrowserCommands.tryToCloseWindow(e));
    bar.append(drag, buttons);
    doc.documentElement.append(bar);
  },

  _initEmptyState(win) {
    if (!win.gInitialPages.includes(EMPTY_URL)) {
      win.gInitialPages.push(EMPTY_URL);
    }
    const gBrowser = win.gBrowser;
    gBrowser.tabContainer.addEventListener("TabClose", e => {
      if (e.target.hasAttribute("skein-empty")) {
        return;
      }
      win.setTimeout(() => {
        const tabs = gBrowser.tabs.filter(t => !t.closing);
        if (tabs.length === 1 && !tabs[0].pinned && !tabs[0].hasAttribute("skein-empty") && win.isBlankPageURL(tabs[0].linkedBrowser.currentURI.spec)) {
          this._makeEmpty(win, tabs[0]);
        }
      }, 0);
    });
    gBrowser.addTabsProgressListener({
      onLocationChange(browser, webProgress, request, location) {
        if (!webProgress.isTopLevel || location.spec === EMPTY_URL) {
          return;
        }
        const tab = gBrowser.getTabForBrowser(browser);
        if (tab?.hasAttribute("skein-empty") && !win.isBlankPageURL(location.spec)) {
          tab.removeAttribute("skein-empty");
        }
      },
    });
    gBrowser.tabContainer.addEventListener("TabOpen", e => {
      if (e.target.hasAttribute("skein-empty")) {
        return;
      }
      win.setTimeout(() => {
        for (const t of gBrowser.tabs.filter(x => x.hasAttribute("skein-empty") && !x.closing)) {
          if (gBrowser.tabs.length > 1) {
            gBrowser.removeTab(t, { animate: false });
          }
        }
      }, 0);
    });
  },

  /** At app start, a window with just a blank new tab shows the empty page, as Zen does. */
  _emptyOnStartup(win) {
    const check = () => {
      const tabs = win.gBrowser.tabs.filter(t => !t.closing);
      const t = tabs[0];
      const browser = t.linkedBrowser;
      const restoring = t.hasAttribute("pending") || !!browser.userTypedValue || browser.webProgress?.isLoadingDocument;
      if (tabs.length === 1 && !t.pinned && !restoring && !t.hasAttribute("skein-empty") && win.isBlankPageURL(t.linkedBrowser.currentURI.spec)) {
        this._makeEmpty(win, t);
      }
    };
    if (this._startupHandled || win.SessionStore.willAutoRestore || win.PrivateBrowsingUtils?.isWindowPrivate(win)) {
      this._startupHandled = true;
      return;
    }
    this._startupHandled = true;
    win.SessionStore.promiseAllWindowsRestored.then(() => win.setTimeout(check, 0));
  },

  _makeEmpty(win, tab) {
    tab.setAttribute("skein-empty", "true");
    tab.linkedBrowser.fixupAndLoadURIString(EMPTY_URL, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  },

  _onCommand(win, e) {
    if (e.target?.id === "sidebar-button" && Services.prefs.getBoolPref("skein.ui.zen", true)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      togglePref(PREF_HIDE_SIDEBAR);
      return;
    }
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
    if (e.key === "Escape" && win.document.documentElement.hasAttribute("skein-glance-open")) {
      this.closeGlance(win);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const accel = e.ctrlKey || e.metaKey;
    if (accel && e.altKey && !e.shiftKey) {
      if (e.code === "KeyC") {
        togglePref(PREF_COMPACT);
      } else if (e.code === "KeyB") {
        togglePref(PREF_HIDE_SIDEBAR);
      } else if (e.code === "KeyV") {
        this.toggleSplit(win);
      } else {
        return;
      }
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  },

  /**
   * Ctrl+Alt+V: put the current tab side by side with the next tab (or a new
   * one); pressing it again separates them. Uses Firefox's split view.
   */
  toggleSplit(win) {
    const gBrowser = win.gBrowser;
    const tab = gBrowser.selectedTab;
    if (tab.splitview) {
      tab.splitview.unsplitTabs();
      return;
    }
    if (tab.pinned || typeof gBrowser.addTabSplitView !== "function") {
      return;
    }
    const tabs = gBrowser.visibleTabs.filter(t => !t.pinned && !t.splitview && !t.hasAttribute("skein-glance"));
    let other = tabs[tabs.indexOf(tab) + 1] || tabs[tabs.indexOf(tab) - 1];
    if (!other) {
      other = gBrowser.addTrustedTab("about:newtab", { relatedToCurrent: true });
    }
    gBrowser.addTabSplitView([tab, other], { insertBefore: tab });
  },

  /**
   * New tab opens the real address bar, floating over the page, with the
   * same autofill, suggestions and search engine as Ctrl+L. Whatever is
   * picked opens in a new tab; Esc or clicking away leaves things as they were.
   */
  showBar(win) {
    const urlbar = win.gURLBar;
    const root = win.document.documentElement;
    if (!urlbar._skeinNewTabHooked) {
      urlbar._skeinNewTabHooked = true;
      const where = urlbar._whereToOpen.bind(urlbar);
      urlbar._whereToOpen = event => {
        const w = where(event);
        return root.hasAttribute("skein-newtab-mode") && w === "current" && !win.gBrowser.selectedTab.hasAttribute("skein-empty") ? "tab" : w;
      };
      const exit = () => {
        if (root.hasAttribute("skein-newtab-mode")) {
          root.removeAttribute("skein-newtab-mode");
          urlbar.handleRevert();
        }
      };
      urlbar.inputField.addEventListener("blur", () => win.setTimeout(exit, 0));
      urlbar.inputField.addEventListener(
        "keydown",
        e => {
          if (e.key === "Escape" && root.hasAttribute("skein-newtab-mode") && !urlbar.view.isOpen) {
            e.preventDefault();
            exit();
            win.gBrowser.selectedBrowser.focus();
          }
        },
        true
      );
    }
    root.setAttribute("skein-newtab-mode", "true");
    urlbar.value = "";
    urlbar.focus();
    urlbar.select();
    urlbar.startQuery?.({ allowAutofill: false });
  },

  hideBar(win) {
    win.document.documentElement.removeAttribute("skein-newtab-mode");
  },
};
