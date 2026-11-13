/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The stable surface: the design tokens and interface regions Skein promises
 * to keep working across Firefox ESR updates. Skills and the generated
 * SKILL.md rely on these names. scripts/check-stable-surface.mjs verifies on
 * every upstream merge that everything listed here still exists in the tree.
 *
 * No Gecko dependencies: this file is also imported from Node.
 */

export const SURFACE_VERSION = 1;
export const BASE_VERSION = "153.7.0esr";

/**
 * Skein tokens. A skill declares them (normally on :root); Skein maps each
 * one onto the upstream custom properties in `maps`, so skills never need to
 * know Firefox's internal token names.
 */
export const TOKENS = {
  "--skein-chrome-bg": {
    description: "Background of the window frame: tab strip, title bar area, sidebar launcher.",
    maps: ["--toolbox-background-color", "--toolbox-background-color-inactive"],
  },
  "--skein-chrome-fg": {
    description: "Text and icon colour on the window frame.",
    maps: ["--toolbox-text-color", "--toolbox-text-color-inactive"],
  },
  "--skein-toolbar-bg": {
    description: "Background of the navigation toolbar and bookmarks bar.",
    maps: ["--toolbar-background-color"],
  },
  "--skein-toolbar-fg": {
    description: "Text and icon colour on the navigation toolbar.",
    maps: ["--toolbar-text-color", "--toolbarbutton-icon-fill"],
  },
  "--skein-field-bg": {
    description: "Background of the address bar.",
    maps: ["--toolbar-field-background-color", "--toolbar-field-background-color-focus"],
  },
  "--skein-field-fg": {
    description: "Text colour of the address bar. Must stay readable against --skein-field-bg.",
    maps: ["--toolbar-field-text-color", "--toolbar-field-text-color-focus"],
  },
  "--skein-field-border": {
    description: "Border colour of the address bar.",
    maps: ["--toolbar-field-border-color"],
  },
  "--skein-accent": {
    description: "Accent colour: focus rings, focused address bar border, primary buttons.",
    maps: ["--color-accent-primary", "--focus-outline-color", "--toolbar-field-border-color-focus"],
  },
  "--skein-tab-selected-bg": {
    description: "Background of the selected tab.",
    maps: ["--tab-background-color-selected"],
  },
  "--skein-sidebar-bg": {
    description: "Background of the sidebar.",
    maps: ["--sidebar-background-color"],
  },
  "--skein-sidebar-fg": {
    description: "Text colour of the sidebar.",
    maps: ["--sidebar-text-color"],
  },
  "--skein-panel-bg": {
    description: "Background of menus and panels.",
    maps: ["--panel-background-color"],
  },
  "--skein-panel-fg": {
    description: "Text colour of menus and panels.",
    maps: ["--panel-text-color"],
  },
  "--skein-radius": {
    description: "Corner radius of toolbar buttons and tabs.",
    maps: ["--toolbarbutton-border-radius", "--tab-border-radius"],
  },
};

/** Regions a skill may target with CSS. `kind` mirrors the validator tiers. */
export const REGIONS = [
  { selector: "#navigator-toolbox", kind: "container", description: "Everything above the page: tab strip, navigation toolbar, bookmarks bar." },
  { selector: "#TabsToolbar", kind: "normal", description: "Horizontal tab strip toolbar." },
  { selector: "#tabbrowser-tabs", kind: "normal", description: "The tab list (horizontal or vertical)." },
  { selector: ".tabbrowser-tab", kind: "normal", description: "One tab. States: [selected], [pinned], [multiselected], :hover." },
  { selector: ".tab-background", kind: "normal", description: "The painted body of a tab." },
  { selector: ".tab-label", kind: "normal", description: "Tab title text." },
  { selector: ".tab-icon-image", kind: "normal", description: "Tab favicon." },
  { selector: ".tab-close-button", kind: "normal", description: "Close button inside a tab." },
  { selector: "#tabs-newtab-button", kind: "normal", description: "New-tab button at the end of the tab list." },
  { selector: "#nav-bar", kind: "container", description: "Navigation toolbar (contains the address bar). Restyle only; cannot be hidden or moved with CSS." },
  { selector: "#back-button", kind: "normal", description: "Back button." },
  { selector: "#forward-button", kind: "normal", description: "Forward button." },
  { selector: "#stop-reload-button", kind: "normal", description: "Reload / stop button." },
  { selector: "#PanelUI-menu-button", kind: "normal", description: "Application menu button." },
  { selector: "#unified-extensions-button", kind: "normal", description: "Extensions button." },
  { selector: "#PersonalToolbar", kind: "normal", description: "Bookmarks toolbar." },
  { selector: "#sidebar-main", kind: "normal", description: "Sidebar launcher; hosts vertical tabs when enabled." },
  { selector: "#sidebar-box", kind: "normal", description: "Sidebar panel (bookmarks, history, ...)." },
  { selector: "#vertical-tabs", kind: "normal", description: "Vertical tab strip container." },
  { selector: "#skein-spaces-widget", kind: "normal", description: "Skein space switcher." },
  { selector: ".skein-space-button", kind: "normal", description: "One space button. States: [selected]. Colour: --skein-space-color." },
  { selector: "#urlbar", kind: "protected", description: "Address bar. Colours, radius and font only." },
  { selector: "#urlbar-input", kind: "protected", description: "Address bar text. Colours and font only." },
  { selector: ".urlbar-background", kind: "protected", description: "Address bar background box. Colours and radius only." },
  { selector: "#identity-box", kind: "protected", description: "Site identity (padlock). Colours only." },
  { selector: "#tabbrowser-tabpanels", kind: "container", description: "The web page area. Cannot be hidden or moved." },
];

/** Root attributes Skein maintains; safe to use in selectors. */
export const ROOT_ATTRIBUTES = [
  { attribute: "skein-space", description: 'Name of the active space, e.g. :root[skein-space="Work"].' },
];
