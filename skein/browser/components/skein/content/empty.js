/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("new-tab").addEventListener("click", () => {
    const win = window.browsingContext.topChromeWindow;
    win?.document.getElementById("cmd_newNavigatorTab")?.doCommand();
  });
});
