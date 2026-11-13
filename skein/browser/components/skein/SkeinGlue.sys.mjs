/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Entry points registered in skein.manifest. Keeps the start-up order of the
 * Skein modules explicit: spaces first (customization resolves per-space
 * skill sets), then privacy, then customization.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SkeinCustomization: "moz-src:///browser/components/skein/SkeinCustomization.sys.mjs",
  SkeinPrivacy: "moz-src:///browser/components/skein/SkeinPrivacy.sys.mjs",
  SkeinSpaces: "moz-src:///browser/components/skein/SkeinSpaces.sys.mjs",
});

const BUILTIN_SHEET = "chrome://browser/content/skein/skein-browser.css";

function guard(label, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`Skein: ${label} failed`, e);
  }
}

export const SkeinGlue = {
  browserFirstWindowReady() {
    guard("privacy init", () => lazy.SkeinPrivacy.browserFirstWindowReady());
    guard("customization init", () => lazy.SkeinCustomization.browserFirstWindowReady());
  },

  browserWindowDelayedStartup(win) {
    guard("built-in sheet", () => win.windowUtils.loadSheetUsingURIString(BUILTIN_SHEET, win.windowUtils.AUTHOR_SHEET));
    guard("spaces window init", () => lazy.SkeinSpaces.browserWindowDelayedStartup(win));
    guard("privacy window init", () => lazy.SkeinPrivacy.browserWindowDelayedStartup(win));
    guard("customization window init", () => lazy.SkeinCustomization.browserWindowDelayedStartup(win));
  },

  browserWindowUnload(win) {
    guard("spaces window unload", () => lazy.SkeinSpaces.browserWindowUnload(win));
    guard("customization window unload", () => lazy.SkeinCustomization.browserWindowUnload(win));
  },
};
