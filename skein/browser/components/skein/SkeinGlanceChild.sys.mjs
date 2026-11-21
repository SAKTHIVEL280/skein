/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Alt+click on a web link opens it in Glance instead of following it.
 */
export class SkeinGlanceChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type !== "click" || event.button !== 0 || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !event.isTrusted) {
      return;
    }
    if (!Services.prefs.getBoolPref("skein.glance.altClick", true)) {
      return;
    }
    const link = event.composedTarget?.closest?.("a[href], area[href]");
    if (!link || !/^https?:$/.test(new URL(link.href).protocol)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.sendAsyncMessage("Skein:Glance", { url: link.href });
  }
}
