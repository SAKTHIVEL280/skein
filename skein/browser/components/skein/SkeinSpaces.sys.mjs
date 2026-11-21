/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * SkeinSpaces: switchable workspaces. Each tab belongs to one space; switching
 * spaces shows that space's tabs and hides the rest. Pinned tabs (Essentials)
 * belong to a space too, so every space has its own Essentials. Folders inside a space are upstream tab groups.
 *
 * A space is organizational only. It is NOT a security boundary: isolation
 * comes from the container a space may be bound to (new tabs opened in the
 * space use that container), and the UI must not suggest otherwise.
 *
 * This is Skein's own implementation on top of public tabbrowser APIs
 * (hideTab/showTab, SessionStore custom values). It contains no Zen code.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  ContextualIdentityService: "resource://gre/modules/ContextualIdentityService.sys.mjs",
  CustomizableUI: "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SessionStore: "resource:///modules/sessionstore/SessionStore.sys.mjs",
  SkeinCustomization: "moz-src:///browser/components/skein/SkeinCustomization.sys.mjs",
});

const PREF_LIST = "skein.spaces.list";
const PREF_LABELS = "skein.spaces.showLabels";
const TAB_KEY = "skeinSpace";
const WINDOW_KEY = "skeinSpace";
const HIDDEN_BY = "skein-spaces";
const WIDGET_ID = "skein-spaces-widget";
const TOPIC_CHANGED = "skein-spaces-changed";

export const SPACE_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
const COLOR_VALUES = {
  blue: "#37adff",
  turquoise: "#00c79a",
  green: "#51cd00",
  yellow: "#ffcb00",
  orange: "#ff9f00",
  red: "#ff613d",
  pink: "#ff4bda",
  purple: "#af51f5",
};

function newId() {
  return "s" + Math.random().toString(36).slice(2, 10);
}

export const SkeinSpaces = {
  _spaces: null,
  _windows: new WeakMap(),
  _widgetCreated: false,

  /* ----------------------------------------------------------------- data */

  get spaces() {
    if (!this._spaces) {
      let list = [];
      try {
        list = JSON.parse(Services.prefs.getStringPref(PREF_LIST, "[]"));
      } catch (e) {}
      list = Array.isArray(list)
        ? list
            .filter(s => s && typeof s.id === "string" && typeof s.name === "string")
            .map(s => ({
              id: s.id,
              name: s.name.slice(0, 64),
              color: SPACE_COLORS.includes(s.color) ? s.color : "blue",
              containerId: Number.isInteger(s.containerId) && s.containerId > 0 ? s.containerId : 0,
            }))
        : [];
      if (!list.length) {
        list = [{ id: "home", name: "Home", color: "blue", containerId: 0 }];
      }
      this._spaces = list;
    }
    return this._spaces;
  },

  _save() {
    Services.prefs.setStringPref(PREF_LIST, JSON.stringify(this._spaces));
    for (const win of lazy.BrowserWindowTracker.orderedWindows) {
      this._render(win);
    }
    Services.obs.notifyObservers(null, TOPIC_CHANGED);
  },

  spaceNames() {
    return this.spaces.map(s => s.name);
  },

  getSpace(id) {
    return this.spaces.find(s => s.id === id) || null;
  },

  createSpace(name, { color, containerId = 0 } = {}) {
    name = String(name).trim().slice(0, 64);
    if (!name) {
      return null;
    }
    const space = {
      id: newId(),
      name,
      color: SPACE_COLORS.includes(color) ? color : SPACE_COLORS[this.spaces.length % SPACE_COLORS.length],
      containerId: Number.isInteger(containerId) && containerId > 0 ? containerId : 0,
    };
    this.spaces.push(space);
    this._save();
    return space;
  },

  updateSpace(id, { name, color, containerId }) {
    const space = this.getSpace(id);
    if (!space) {
      return;
    }
    if (typeof name === "string" && name.trim()) {
      space.name = name.trim().slice(0, 64);
    }
    if (SPACE_COLORS.includes(color)) {
      space.color = color;
    }
    if (Number.isInteger(containerId) && containerId >= 0) {
      space.containerId = containerId;
    }
    this._save();
  },

  /** Delete a space; its tabs move to the first remaining space. */
  deleteSpace(id) {
    if (this.spaces.length <= 1 || !this.getSpace(id)) {
      return false;
    }
    this._spaces = this.spaces.filter(s => s.id !== id);
    const fallback = this._spaces[0].id;
    for (const win of lazy.BrowserWindowTracker.orderedWindows) {
      const state = this._windows.get(win);
      if (!state) {
        continue;
      }
      for (const tab of win.gBrowser.tabs) {
        if (this._tabSpace(win, tab) === id) {
          this._setTabSpace(tab, fallback);
        }
      }
      if (state.active === id) {
        this.switchTo(win, fallback);
      } else {
        this._syncVisibility(win);
      }
    }
    this._save();
    return true;
  },

  /* -------------------------------------------------------------- windows */

  _isEligible(win) {
    return (
      win &&
      !win.closed &&
      win.gBrowser &&
      win.toolbar.visible &&
      // Private windows have one implicit space and the stock layout.
      !lazy.PrivateBrowsingUtils.isWindowPrivate(win)
    );
  },

  browserWindowDelayedStartup(win) {
    if (!this._isEligible(win)) {
      return;
    }
    this._ensureWidget();
    const state = { active: this.spaces[0].id, lastTab: new Map() };
    this._windows.set(win, state);

    const restoreActive = () => {
      let saved = "";
      try {
        saved = lazy.SessionStore.getCustomWindowValue(win, WINDOW_KEY);
      } catch (e) {}
      if (saved && this.getSpace(saved)) {
        state.active = saved;
      }
    };
    restoreActive();

    const container = win.gBrowser.tabContainer;
    container.addEventListener("TabOpen", event => {
      const tab = event.target;
      const activeAtOpen = state.active;
      tab._skeinPending = activeAtOpen;
      // Decide after the opener has finished: session restore attaches the
      // saved space right after creating the tab, and values written during
      // TabOpen are not kept.
      win.setTimeout(() => {
        if (tab.closing || !tab.isConnected || tab._skeinSpace) {
          return;
        }
        let saved = "";
        try {
          saved = lazy.SessionStore.getCustomTabValue(tab, TAB_KEY);
        } catch (e) {}
        this._setTabSpace(tab, saved && this.getSpace(saved) ? saved : activeAtOpen);
        this._syncVisibility(win);
      }, 0);
    });
    container.addEventListener("TabSelect", event => {
      const tab = event.target;
      const space = this._tabSpace(win, tab);
      state.lastTab.set(space, tab);
      // Selecting a tab from another space (tab search, "switch to tab")
      // brings its space with it.
      if (space !== state.active) {
        this.switchTo(win, space);
      }
    });
    container.addEventListener("SSTabRestoring", event => {
      const tab = event.target;
      let saved = "";
      try {
        saved = lazy.SessionStore.getCustomTabValue(tab, TAB_KEY);
      } catch (e) {}
      if (saved && this.getSpace(saved)) {
        tab._skeinSpace = saved;
      }
      this._syncVisibility(win);
    });
    win.addEventListener("SSWindowStateReady", () => {
      restoreActive();
      this._syncVisibility(win);
      this._render(win);
    });
    for (const type of ["TabGroupCreate", "TabGrouped", "TabUngrouped", "TabMove"]) {
      container.addEventListener(type, () => this._syncGroups(win));
    }

    for (const tab of win.gBrowser.tabs) {
      if (!tab._skeinSpace) {
        this._setTabSpace(tab, this._tabSpace(win, tab));
      }
    }
    this._installTabMenu(win);
    this._syncVisibility(win);
    this._render(win);
  },

  browserWindowUnload(win) {
    this._windows.delete(win);
  },

  activeSpace(win) {
    const state = this._windows.get(win);
    return state ? this.getSpace(state.active) || this.spaces[0] : null;
  },

  /** Name of the window's active space, or undefined for windows without spaces. */
  activeSpaceName(win) {
    return this.activeSpace(win)?.name;
  },

  /** Container for a brand-new tab opened by the user in this window (0 = none). */
  containerForNewTab(win) {
    const space = this.activeSpace(win);
    if (!space?.containerId) {
      return 0;
    }
    // The container may have been deleted since the space was bound to it.
    return lazy.ContextualIdentityService.getPublicIdentityFromId(space.containerId) ? space.containerId : 0;
  },

  _tabSpace(win, tab) {
    if (tab._skeinSpace && this.getSpace(tab._skeinSpace)) {
      return tab._skeinSpace;
    }
    let saved = "";
    try {
      saved = lazy.SessionStore.getCustomTabValue(tab, TAB_KEY);
    } catch (e) {}
    if (saved && this.getSpace(saved)) {
      tab._skeinSpace = saved;
      return saved;
    }
    // Not assigned yet (still opening): the space it was opened in.
    if (tab._skeinPending && this.getSpace(tab._skeinPending)) {
      return tab._skeinPending;
    }
    return this._windows.get(win)?.active || this.spaces[0].id;
  },

  _setTabSpace(tab, id) {
    tab._skeinSpace = id;
    try {
      lazy.SessionStore.setCustomTabValue(tab, TAB_KEY, id);
    } catch (e) {}
  },

  _syncVisibility(win) {
    const state = this._windows.get(win);
    if (!state) {
      return;
    }
    const gBrowser = win.gBrowser;
    for (const tab of gBrowser.tabs) {
      if (tab.closing) {
        continue;
      }
      const space = this._tabSpace(win, tab);
      // Pinned tabs cannot be hidden by tabbrowser; Skein's style hides them.
      tab.toggleAttribute("skein-space-hidden", tab.pinned && space !== state.active);
      if (tab.pinned || space === state.active) {
        // Only un-hide what Skein hid; extensions may hide tabs too.
        if (tab.hidden && tab._skeinHidden) {
          gBrowser.showTab(tab);
        }
        tab._skeinHidden = false;
      } else if (!tab.hidden) {
        gBrowser.hideTab(tab, HIDDEN_BY);
        tab._skeinHidden = tab.hidden;
      } else if (lazy.SessionStore.getCustomTabValue(tab, "hiddenBy") === HIDDEN_BY) {
        tab._skeinHidden = true;
      }
    }
    this._syncGroups(win);
  },

  /** Hide tab groups (folders) that only contain tabs of other spaces. */
  _syncGroups(win) {
    const state = this._windows.get(win);
    if (!state) {
      return;
    }
    for (const group of win.gBrowser.tabGroups || []) {
      const tabs = group.tabs || [];
      const foreign = !!tabs.length && tabs.every(t => !t.pinned && this._tabSpace(win, t) !== state.active);
      group.toggleAttribute("skein-space-hidden", foreign);
    }
  },

  switchTo(win, id) {
    const state = this._windows.get(win);
    const space = this.getSpace(id);
    if (!state || !space) {
      return;
    }
    const gBrowser = win.gBrowser;
    if (state.active !== id) {
      const from = this.spaces.findIndex(s => s.id === state.active);
      const to = this.spaces.findIndex(s => s.id === id);
      const root = win.document.documentElement;
      root.setAttribute("skein-space-switch", to > from ? "next" : "prev");
      win.clearTimeout(state.switchTimer);
      state.switchTimer = win.setTimeout(() => root.removeAttribute("skein-space-switch"), 260);
    }
    state.previous = state.active;
    state.active = id;
    try {
      lazy.SessionStore.setCustomWindowValue(win, WINDOW_KEY, id);
    } catch (e) {}

    const selected = gBrowser.selectedTab;
    if (this._tabSpace(win, selected) !== id) {
      const inSpace = gBrowser.tabs.filter(t => !t.closing && this._tabSpace(win, t) === id);
      let target = state.lastTab.get(id);
      if (!target || !inSpace.includes(target)) {
        target = inSpace[inSpace.length - 1];
      }
      if (!target) {
        // First visit to an empty space: give it a new tab (state.active is
        // already this space, so TabOpen files the tab here).
        target = gBrowser.addTrustedTab(win.BROWSER_NEW_TAB_URL, {
          userContextId: this.containerForNewTab(win),
          skipAnimation: true,
        });
        this._setTabSpace(target, id);
      }
      if (target.hidden) {
        gBrowser.showTab(target);
        target._skeinHidden = false;
      }
      gBrowser.selectedTab = target;
    }
    this._syncVisibility(win);
    this._render(win);
    lazy.SkeinCustomization.onSpaceChanged(win);
  },

  switchToIndex(win, index) {
    const space = this.spaces[index];
    if (space) {
      this.switchTo(win, space.id);
    }
  },

  cycle(win, delta) {
    const state = this._windows.get(win);
    if (!state) {
      return;
    }
    const i = this.spaces.findIndex(s => s.id === state.active);
    const next = this.spaces[(i + delta + this.spaces.length) % this.spaces.length];
    this.switchTo(win, next.id);
  },

  moveTabsToSpace(win, tabs, id) {
    const state = this._windows.get(win);
    if (!state || !this.getSpace(id)) {
      return;
    }
    const gBrowser = win.gBrowser;
    tabs = tabs.filter(t => !t.closing);
    for (const tab of tabs) {
      this._setTabSpace(tab, id);
      // A folder belongs to one space; leaving the space leaves the folder.
      if (tab.group && id !== state.active) {
        gBrowser.ungroupTab(tab);
      }
    }
    if (id !== state.active && tabs.includes(gBrowser.selectedTab)) {
      const stay = gBrowser.tabs.find(t => !t.closing && !tabs.includes(t) && this._tabSpace(win, t) === state.active);
      gBrowser.selectedTab = stay || gBrowser.addTrustedTab(win.BROWSER_NEW_TAB_URL, { userContextId: this.containerForNewTab(win) });
    }
    this._syncVisibility(win);
  },

  promptNewSpace(win) {
    const input = { value: "" };
    const ok = Services.prompt.prompt(win, "New space", "Name for the new space:", input, null, {});
    if (!ok) {
      return;
    }
    const space = this.createSpace(input.value);
    if (space) {
      this.switchTo(win, space.id);
    }
  },

  /* ------------------------------------------------------------------- UI */

  _ensureWidget() {
    if (this._widgetCreated) {
      return;
    }
    this._widgetCreated = true;
    Services.prefs.addObserver(PREF_LABELS, () => {
      for (const win of lazy.BrowserWindowTracker.orderedWindows) {
        this._render(win);
      }
    });
    lazy.CustomizableUI.createWidget({
      id: WIDGET_ID,
      type: "custom",
      defaultArea: lazy.CustomizableUI.AREA_NAVBAR,
      removable: true,
      onBuild: doc => {
        const item = doc.createXULElement("toolbaritem");
        item.id = WIDGET_ID;
        item.className = "chromeclass-toolbar-additional";
        item.setAttribute("label", "Spaces");
        item.setAttribute("tooltiptext", "Spaces");
        item.setAttribute("removable", "true");
        const list = doc.createXULElement("hbox");
        list.className = "skein-spaces-list";
        list.setAttribute("role", "tablist");
        list.setAttribute("aria-label", "Spaces");
        item.appendChild(list);
        const add = doc.createXULElement("toolbarbutton");
        add.className = "skein-space-add toolbarbutton-1";
        add.setAttribute("label", "+");
        add.setAttribute("tooltiptext", "New space");
        add.addEventListener("command", () => this.promptNewSpace(doc.defaultView));
        item.appendChild(add);
        doc.defaultView.setTimeout(() => this._render(doc.defaultView), 0);
        return item;
      },
    });
  },

  _render(win) {
    const state = this._windows.get(win);
    if (!state) {
      return;
    }
    const doc = win.document;
    const active = this.activeSpace(win);
    doc.documentElement.setAttribute("skein-space", active.name);
    const list = doc.querySelector(`#${WIDGET_ID} .skein-spaces-list`);
    if (!list) {
      return;
    }
    const showLabels = Services.prefs.getBoolPref(PREF_LABELS, false);
    list.replaceChildren();
    this.spaces.forEach((space, index) => {
      const button = doc.createXULElement("toolbarbutton");
      button.className = "skein-space-button";
      button.setAttribute("role", "tab");
      button.setAttribute("label", showLabels ? space.name : [...space.name][0].toUpperCase());
      button.setAttribute("aria-label", space.name);
      const bound = space.containerId ? lazy.ContextualIdentityService.getUserContextLabel(space.containerId) : "";
      button.setAttribute("tooltiptext", `${space.name}${bound ? ` (new tabs open in the “${bound}” container)` : ""}${index < 9 ? ` — space ${index + 1}` : ""}`);
      button.style.setProperty("--skein-space-color", COLOR_VALUES[space.color]);
      button.toggleAttribute("selected", space.id === active.id);
      button.setAttribute("aria-selected", space.id === active.id);
      button.toggleAttribute("show-label", showLabels);
      if (space.id === active.id) {
        button.setAttribute("label", space.name);
        button.setAttribute("show-label", "true");
      }
      button.addEventListener("command", () => this.switchTo(win, space.id));
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        this._openSpaceMenu(win, button, space);
      });
      list.appendChild(button);
    });
  },

  _openSpaceMenu(win, anchor, space) {
    const doc = win.document;
    doc.getElementById("skein-space-menu")?.remove();
    const popup = doc.createXULElement("menupopup");
    popup.id = "skein-space-menu";
    const add = (label, handler, disabled = false) => {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.disabled = disabled;
      item.addEventListener("command", handler);
      popup.appendChild(item);
    };
    add("Rename…", () => {
      const input = { value: space.name };
      if (Services.prompt.prompt(win, "Rename space", "Name:", input, null, {})) {
        this.updateSpace(space.id, { name: input.value });
      }
    });
    const colors = doc.createXULElement("menu");
    colors.setAttribute("label", "Color");
    const colorPopup = doc.createXULElement("menupopup");
    for (const color of SPACE_COLORS) {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", color[0].toUpperCase() + color.slice(1));
      item.setAttribute("type", "radio");
      item.toggleAttribute("checked", space.color === color);
      item.addEventListener("command", () => this.updateSpace(space.id, { color }));
      colorPopup.appendChild(item);
    }
    colors.appendChild(colorPopup);
    popup.appendChild(colors);

    const containers = doc.createXULElement("menu");
    containers.setAttribute("label", "Open new tabs in container");
    const containerPopup = doc.createXULElement("menupopup");
    const addContainer = (label, id) => {
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.setAttribute("type", "radio");
      item.toggleAttribute("checked", space.containerId === id);
      item.addEventListener("command", () => this.updateSpace(space.id, { containerId: id }));
      containerPopup.appendChild(item);
    };
    addContainer("No container", 0);
    for (const identity of lazy.ContextualIdentityService.getPublicIdentities()) {
      addContainer(lazy.ContextualIdentityService.getUserContextLabel(identity.userContextId), identity.userContextId);
    }
    containers.appendChild(containerPopup);
    popup.appendChild(containers);

    popup.appendChild(doc.createXULElement("menuseparator"));
    add("Delete space", () => this.deleteSpace(space.id), this.spaces.length <= 1);
    add("Manage spaces…", () => win.switchToTabHavingURI("about:skein#spaces", true));
    popup.addEventListener("popuphidden", event => {
      if (event.target === popup) {
        popup.remove();
      }
    });
    doc.getElementById("mainPopupSet").appendChild(popup);
    popup.openPopup(anchor, "after_start");
  },

  _installTabMenu(win) {
    const doc = win.document;
    const tabMenu = doc.getElementById("tabContextMenu");
    if (!tabMenu || doc.getElementById("skein-move-to-space")) {
      return;
    }
    const menu = doc.createXULElement("menu");
    menu.id = "skein-move-to-space";
    menu.setAttribute("label", "Move to Space");
    const popup = doc.createXULElement("menupopup");
    menu.appendChild(popup);
    const anchor = doc.getElementById("context_moveTabOptions") || doc.getElementById("context_reopenInContainer");
    if (anchor) {
      anchor.before(menu);
    } else {
      tabMenu.appendChild(menu);
    }
    tabMenu.addEventListener("popupshowing", event => {
      if (event.target !== tabMenu) {
        return;
      }
      const contextTab = win.TabContextMenu?.contextTab;
      const state = this._windows.get(win);
      menu.hidden = !state || !contextTab || this.spaces.length < 2;
      if (menu.hidden) {
        return;
      }
      popup.replaceChildren();
      const current = this._tabSpace(win, contextTab);
      for (const space of this.spaces) {
        const item = doc.createXULElement("menuitem");
        item.setAttribute("label", space.name);
        item.disabled = space.id === current;
        item.addEventListener("command", () => {
          const tabs = contextTab.multiselected ? win.gBrowser.selectedTabs : [contextTab];
          this.moveTabsToSpace(win, tabs, space.id);
        });
        popup.appendChild(item);
      }
    });
  },
};
