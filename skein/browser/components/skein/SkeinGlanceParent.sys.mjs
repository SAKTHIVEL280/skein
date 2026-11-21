/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SkeinFocus: "moz-src:///browser/components/skein/SkeinFocus.sys.mjs",
});

export class SkeinGlanceParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name !== "Skein:Glance") {
      return;
    }
    const browser = this.browsingContext.top.embedderElement;
    const win = browser?.documentGlobal;
    if (!win?.gBrowser || lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }
    const principal = this.manager.documentPrincipal;
    try {
      Services.scriptSecurityManager.checkLoadURIStrWithPrincipal(principal, message.data.url);
    } catch (e) {
      return;
    }
    lazy.SkeinFocus.openGlance(win, message.data.url, principal);
  }
}
