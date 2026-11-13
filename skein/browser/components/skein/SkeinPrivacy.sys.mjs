/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * SkeinPrivacy: Privacy mode, v1.
 *
 * The user sees two modes, Standard and Privacy. Behind the Privacy switch:
 *
 *  - Hand-off (default): open the official Tor Browser. Skein does not try to
 *    be Tor Browser; a customizable browser cannot honestly promise that.
 *  - Proxy: if the user supplied a SOCKS5 proxy (a VPN provider's proxy, an
 *    SSH tunnel, a local Tor daemon), Privacy windows are private windows
 *    whose every request is forced through it, with DNS resolved by the proxy.
 *    There is no direct fallback: if the proxy is down, requests fail
 *    (kill switch).
 *
 * Skills never apply in these windows (see SkeinCustomization._isEligible).
 * Nothing here makes the user anonymous, and the UI must not say so.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const PREF_PROXY_HOST = "skein.privacy.proxy.host";
const PREF_PROXY_PORT = "skein.privacy.proxy.port";
const PREF_TOR_PATH = "skein.privacy.torBrowserPath";
const TOR_DOWNLOAD_URL = "https://www.torproject.org/download/";
const INDICATOR_ID = "skein-privacy-indicator";

export const LEAK_TEST_URLS = ["https://check.torproject.org/", "https://browserleaks.com/ip", "https://browserleaks.com/webrtc", "https://browserleaks.com/dns"];

function fileIfExecutable(path) {
  try {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    if (file.exists() && file.isFile()) {
      return file;
    }
  } catch (e) {}
  return null;
}

export const SkeinPrivacy = {
  _registered: false,

  /* ---------------------------------------------------------------- proxy */

  /** The configured proxy, or null when Privacy mode is hand-off only. */
  get proxy() {
    const host = Services.prefs.getStringPref(PREF_PROXY_HOST, "").trim();
    const port = Services.prefs.getIntPref(PREF_PROXY_PORT, 0);
    if (!host || !/^[A-Za-z0-9.\-:[\]]+$/.test(host) || port < 1 || port > 65535) {
      return null;
    }
    return { host, port };
  },

  setProxy(host, port) {
    Services.prefs.setStringPref(PREF_PROXY_HOST, String(host || "").trim());
    Services.prefs.setIntPref(PREF_PROXY_PORT, Number(port) || 0);
    this._refreshIndicators();
  },

  browserFirstWindowReady() {
    if (this._registered) {
      return;
    }
    this._registered = true;
    const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
    pps.registerChannelFilter(this, 0);
    Services.prefs.addObserver("skein.privacy.proxy.", () => this._refreshIndicators());
  },

  /**
   * nsIProtocolProxyChannelFilter. Every channel that belongs to a private
   * browsing context goes through the configured proxy, and only through it.
   */
  applyFilter(channel, defaultProxy, callback) {
    let result = defaultProxy;
    try {
      const proxy = this.proxy;
      const isPrivate = channel.loadInfo?.originAttributes.privateBrowsingId > 0 || (channel instanceof Ci.nsIPrivateBrowsingChannel && channel.isChannelPrivate);
      if (proxy && isPrivate) {
        const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
        // SOCKS5 with remote DNS, no failover proxy: when the proxy is
        // unreachable the request fails instead of going out directly.
        result = pps.newProxyInfo("socks", proxy.host, proxy.port, "", "", Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 0, null);
      }
    } catch (e) {
      console.error("Skein: proxy filter error; failing closed", e);
      // An unusable proxy entry: connections fail rather than leak.
      try {
        const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
        result = pps.newProxyInfo("socks", "127.0.0.1", 9, "", "", Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 0, null);
      } catch (e2) {}
    }
    callback.onProxyFilterResult(result);
  },

  QueryInterface: ChromeUtils.generateQI(["nsIProtocolProxyChannelFilter"]),

  /* -------------------------------------------------------------- windows */

  browserWindowDelayedStartup(win) {
    if (!lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }
    const doc = win.document;
    const navBar = doc.getElementById("nav-bar-customization-target");
    if (!navBar || doc.getElementById(INDICATOR_ID)) {
      return;
    }
    const indicator = doc.createXULElement("label");
    indicator.id = INDICATOR_ID;
    navBar.appendChild(indicator);
    this._updateIndicator(win);
  },

  _updateIndicator(win) {
    const indicator = win.document.getElementById(INDICATOR_ID);
    if (!indicator) {
      return;
    }
    const proxy = this.proxy;
    indicator.toggleAttribute("protected", !!proxy);
    if (proxy) {
      indicator.setAttribute("value", "Privacy: IP hidden");
      indicator.setAttribute(
        "tooltiptext",
        `Sites see the address of your proxy (${proxy.host}:${proxy.port}) instead of yours. If the proxy stops, pages stop loading. Signing in to a site still identifies you.`
      );
    } else {
      indicator.setAttribute("value", "Private: IP visible");
      indicator.setAttribute("tooltiptext", "This window does not keep history, but sites still see your IP address. Set a proxy in about:skein or use Tor Browser to hide it.");
    }
  },

  _refreshIndicators() {
    for (const win of lazy.BrowserWindowTracker.orderedWindows) {
      this._updateIndicator(win);
    }
  },

  /**
   * The Privacy switch. With a proxy configured: a separate private window
   * routed through it. Without: hand off to Tor Browser.
   * Returns "window", "tor" or "tor-missing".
   */
  openPrivacy(win, urls = []) {
    if (this.proxy) {
      const newWin = win.OpenBrowserWindow({ private: true });
      if (urls.length) {
        newWin.addEventListener(
          "MozAfterPaint",
          () => {
            urls.forEach((url, i) => {
              if (i === 0) {
                newWin.gBrowser.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
              } else {
                newWin.gBrowser.addTrustedTab(url);
              }
            });
          },
          { once: true }
        );
      }
      return "window";
    }
    if (this.launchTorBrowser(urls[0])) {
      return "tor";
    }
    win.switchToTabHavingURI(TOR_DOWNLOAD_URL, true);
    return "tor-missing";
  },

  /* ------------------------------------------------------------------ Tor */

  findTorBrowser() {
    const custom = Services.prefs.getStringPref(PREF_TOR_PATH, "");
    if (custom) {
      return fileIfExecutable(custom);
    }
    const candidates = [];
    const dir = key => {
      try {
        return Services.dirsvc.get(key, Ci.nsIFile).path;
      } catch (e) {
        return null;
      }
    };
    const home = dir("Home");
    switch (Services.appinfo.OS) {
      case "WINNT": {
        const desktop = dir("Desk");
        if (desktop) {
          candidates.push(PathUtils.join(desktop, "Tor Browser", "Browser", "firefox.exe"));
        }
        break;
      }
      case "Darwin":
        candidates.push("/Applications/Tor Browser.app/Contents/MacOS/firefox");
        if (home) {
          candidates.push(PathUtils.join(home, "Applications", "Tor Browser.app", "Contents", "MacOS", "firefox"));
        }
        break;
      default:
        if (home) {
          candidates.push(
            PathUtils.join(home, ".local", "share", "torbrowser", "tbb", "x86_64", "tor-browser", "Browser", "start-tor-browser"),
            PathUtils.join(home, "tor-browser", "Browser", "start-tor-browser")
          );
        }
        candidates.push("/usr/bin/torbrowser-launcher", "/usr/bin/tor-browser");
    }
    for (const path of candidates) {
      const file = fileIfExecutable(path);
      if (file) {
        return file;
      }
    }
    return null;
  },

  launchTorBrowser(url) {
    const file = this.findTorBrowser();
    if (!file) {
      return false;
    }
    try {
      const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      process.init(file);
      process.noShell = true;
      const args = [];
      if (file.leafName === "start-tor-browser") {
        args.push("--detach");
      }
      if (url && /^https?:\/\//.test(url)) {
        args.push(url);
      }
      process.runAsync(args, args.length);
      return true;
    } catch (e) {
      console.error("Skein: could not start Tor Browser", e);
      return false;
    }
  },
};
