#!/usr/bin/env python3
"""End-to-end tests for Skein, driven over Marionette against a real build.

    python3 scripts/dev/test_skein.py [path-to-binary] [--headed] [--shots DIR]

Runs with a throwaway profile and a throwaway XDG_CONFIG_HOME, so it never
touches your real profile or customization folder.
"""
import json, os, shutil, socket, sys, tempfile, threading, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mn import Browser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HEADED = "--headed" in sys.argv
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
args = [a for a in sys.argv[1:] if not a.startswith("--") and a != SHOTS]
BINARY = args[0] if args else os.path.join(ROOT, "obj-skein", "dist", "bin", "skein")

TMP = tempfile.mkdtemp(prefix="skein-test-")
CONFIG = os.path.join(TMP, "config")
CUSTOM = os.path.join(CONFIG, "skein-customization", "custom")
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{detail}]" if detail and not cond else ""))


def write(rel, text):
    path = os.path.join(CUSTOM, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text if isinstance(text, str) else json.dumps(text, indent=2))


def skill(sid, touches, **files):
    write(f"skills/{sid}/skill.json", {"id": sid, "name": sid, "touches": touches})
    for name, content in files.items():
        write(f"skills/{sid}/{name.replace('_', '.')}", content)


def enable(*ids, spaces=None):
    root = {"formatVersion": 1, "enabled": list(ids)}
    if spaces:
        root["spaces"] = spaces
    write("skein.json", root)


def status(b, want=None, timeout=10):
    """Wait until Skein has processed the current folder; return its status."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with open(os.path.join(CUSTOM, ".status.json")) as f:
                last = json.load(f)
        except Exception:
            last = None
        if last and (want is None or last["state"] == want):
            # Make sure the poller has caught up with the latest write.
            settled = b.chrome_async("""
              const [resolve] = arguments;
              const { SkeinCustomization: C } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinCustomization.sys.mjs");
              (async () => {
                const sig = C._signature(await C._listFolder());
                resolve(sig === C._lastSignature && !C._busy ? C.status.state : null);
              })();
            """)
            if settled and (want is None or settled == want):
                return last
        time.sleep(0.3)
    return last


def navbar_bg(b):
    return b.chrome("return getComputedStyle(document.documentElement).getPropertyValue('--toolbar-background-color').trim()")


def shot(b, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        b.screenshot(os.path.join(SHOTS, name + ".png"))


class Socks5Probe(threading.Thread):
    """A SOCKS5 server that records what it is asked to connect to, then refuses."""

    def __init__(self):
        super().__init__(daemon=True)
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        self.requests = []

    def run(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            try:
                conn.settimeout(5)
                head = conn.recv(2)
                conn.recv(head[1])
                conn.sendall(b"\x05\x00")
                req = conn.recv(4)
                if req[3] == 3:
                    n = conn.recv(1)[0]
                    host = conn.recv(n).decode()
                    kind = "domain"
                elif req[3] == 1:
                    host = socket.inet_ntoa(conn.recv(4))
                    kind = "ipv4"
                else:
                    host = conn.recv(16).hex()
                    kind = "ipv6"
                conn.recv(2)
                self.requests.append((kind, host))
                conn.sendall(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00")
            except Exception:
                pass
            finally:
                conn.close()


C = 'const { SkeinCustomization: C } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinCustomization.sys.mjs");'
SP = 'const { SkeinSpaces: SP } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinSpaces.sys.mjs");'
PV = 'const { SkeinPrivacy: PV } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinPrivacy.sys.mjs");'


def main():
    env = {"XDG_CONFIG_HOME": CONFIG}
    with Browser(BINARY, os.path.join(TMP, "profile"), headless=not HEADED, env=env) as b:
        # ---------------------------------------------------------- startup
        info = b.chrome("return {name: Services.appinfo.name, vendor: Services.appinfo.vendor, version: Services.appinfo.version, brand: Services.strings.createBundle('chrome://branding/locale/brand.properties').GetStringFromName('brandShortName')}")
        check("branding: app is Skein", info["name"] == "Skein" and info["brand"] == "Skein" and info["vendor"] == "Skein", str(info))
        st = status(b)
        check("customization folder created outside the profile", os.path.isfile(os.path.join(CUSTOM, "skein.json")) and os.path.isfile(os.path.join(CUSTOM, "SKILL.md")))
        check("initial status is 'empty'", st and st["state"] == "empty", str(st))
        check("SKILL.md lists tokens and rules", "--skein-chrome-bg" in open(os.path.join(CUSTOM, "SKILL.md")).read())
        prefs = b.chrome("return [Services.prefs.getBoolPref('datareporting.healthreport.uploadEnabled'), Services.prefs.getBoolPref('toolkit.telemetry.unified'), Services.prefs.getBoolPref('app.shield.optoutstudies.enabled'), Services.prefs.getBoolPref('browser.newtabpage.activity-stream.showSponsored'), Services.prefs.getBoolPref('dom.security.https_only_mode'), Services.prefs.getBoolPref('sidebar.verticalTabs')]")
        check("privacy defaults: telemetry/studies/sponsored off, HTTPS-only on, vertical tabs on", prefs == [False, False, False, False, True, True], str(prefs))
        stock_bg = navbar_bg(b)
        shot(b, "01-stock")

        # ------------------------------------------------------ valid skill
        skill("midnight", ["css", "layout"],
              chrome_css=":root {\n  --skein-chrome-bg: #14121f;\n  --skein-chrome-fg: #e8e6f0;\n  --skein-toolbar-bg: #1d1a2e;\n  --skein-toolbar-fg: #e8e6f0;\n  --skein-field-bg: #2a2640;\n  --skein-field-fg: #ffffff;\n  --skein-accent: #8f6bff;\n  --skein-tab-selected-bg: #2f2a4a;\n  --skein-radius: 10px;\n}\n",
              layout_json={"tabs": {"orientation": "vertical", "side": "right"}, "density": "compact"})
        enable("midnight")
        st = status(b, "ok")
        check("valid skill is applied live", st and st["state"] == "ok" and st["enabled"] == ["midnight"], str(st))
        themed_bg = navbar_bg(b)
        check("token bridge restyles the toolbar", themed_bg == "#1d1a2e", themed_bg)
        lay = b.chrome("return [Services.prefs.getBoolPref('sidebar.verticalTabs'), Services.prefs.getBoolPref('sidebar.position_start'), Services.prefs.getIntPref('browser.uidensity')]")
        check("layout.json moves vertical tabs to the right, compact density", lay == [True, False, 1], str(lay))
        time.sleep(0.5)
        shot(b, "02-midnight")

        # -------------------------------------------- invalid edit: rejected
        skill("evil", ["css"], chrome_css="#urlbar { display: none; }\n.x { background: url(https://evil.example/t.png); }\n")
        enable("midnight", "evil")
        st = status(b, "rejected")
        check("validator rejects hidden urlbar + remote url", st and st["state"] == "rejected" and len(st["errors"]) >= 2, str(st))
        check("errors carry file and line", st and all(e.get("file") and e.get("line") for e in st["errors"]), str(st and st["errors"]))
        check("previous look stays in place after a rejected edit", navbar_bg(b) == themed_bg)

        # -------------------------- passes validator, fails runtime integrity
        skill("evil", ["css"], chrome_css="#fullscr-toggler { display: block !important; position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483647; background-color: white; pointer-events: none; }\n")
        st = status(b, "integrity-failed")
        check("integrity check catches a page overlay with pointer-events:none", st and st["state"] == "integrity-failed" and st["integrity"], str(st))
        pos = b.chrome(C + "return decodeURIComponent(C._windows.get(window)?.sheetURI || '').includes('fullscr-toggler') ? 'still applied' : 'gone'")
        check("overlay bundle was rolled back automatically", pos == "gone" and navbar_bg(b) == themed_bg, pos)

        skill("evil", ["css"], chrome_css=":root { --skein-field-bg: #2a2640; --skein-field-fg: #2b2741; }\n")
        st = status(b, "rejected")
        check("validator rejects a token pair with no contrast", st and st["state"] == "rejected" and any(e["code"] == "css-token-contrast" for e in st["errors"]), str(st))

        skill("evil", ["css"], chrome_css=":root { --toolbar-field-text-color: transparent; --urlbar-min-height: 0px; }\n")
        st = status(b, "rejected")
        check("validator rejects overriding the browser's own variables", st and st["state"] == "rejected" and all(e["code"] == "css-custom-property" for e in st["errors"]), str(st))

        skill("evil", ["css"], chrome_css="#urlbar-input { color: #2a2640; }\n")
        st = status(b, "integrity-failed")
        check("integrity check reads pixels: address bar text matching its background is caught", st and st["state"] == "integrity-failed" and "told apart" in json.dumps(st["integrity"]), str(st))

        os.symlink(os.path.join(TMP, "profile", "prefs.js"), os.path.join(CUSTOM, "skills", "evil", "chrome.css.link"))
        skill("evil", ["css"], chrome_css=".tab-label { color: #ffffff; }\n")
        st = status(b, "rejected")
        check("symlinks in the folder are refused", st and st["state"] == "rejected" and any(e["code"] == "symlink" for e in st["errors"]), str(st))
        os.remove(os.path.join(CUSTOM, "skills", "evil", "chrome.css.link"))

        # -------------------------------------------- second valid + rollback
        skill("sunrise", ["css", "prefs"],
              chrome_css=":root { --skein-toolbar-bg: #ffe9c7; --skein-toolbar-fg: #3b2a10; --skein-field-bg: #fff7ea; --skein-field-fg: #2b1c05; }\n",
              prefs_json={"prefs": {"browser.toolbars.bookmarks.visibility": "always"}})
        shutil.rmtree(os.path.join(CUSTOM, "skills", "evil"))
        enable("sunrise")
        st = status(b, "ok")
        check("switching skills applies live", st and st["enabled"] == ["sunrise"] and navbar_bg(b) == "#ffe9c7", f"{st} {navbar_bg(b)}")
        lay = b.chrome("return [Services.prefs.getBoolPref('sidebar.position_start'), Services.prefs.getIntPref('browser.uidensity'), Services.prefs.getStringPref('browser.toolbars.bookmarks.visibility')]")
        check("prefs of the removed skill are restored, new skill's pref is set", lay == [True, 0, "always"], str(lay))
        shot(b, "03-sunrise")

        snaps = b.chrome_async(C + "const [resolve] = arguments; C.listSnapshots().then(resolve);")
        check("every applied bundle was snapshotted", len(snaps) >= 2 and snaps[0]["current"], str(snaps))
        b.chrome_async(C + "const [resolve] = arguments; C.rollbackToPrevious().then(resolve);")
        st = status(b, "ok")
        check("one-click rollback restores the previous bundle", st and st["enabled"] == ["midnight"] and navbar_bg(b) == themed_bg and os.path.isfile(os.path.join(CUSTOM, "skills", "midnight", "chrome.css")), f"{st} {navbar_bg(b)}")
        check("rollback restored its prefs too", b.chrome("return Services.prefs.getStringPref('browser.toolbars.bookmarks.visibility')") != "always")

        # --------------------------------------------------------- safe mode
        b.chrome("Services.prefs.setBoolPref('skein.safeMode', true)")
        st = status(b, "safe-mode")
        check("safe mode turns every skill off", st and st["state"] == "safe-mode" and navbar_bg(b) == stock_bg, f"{st} {navbar_bg(b)}")
        b.chrome("Services.prefs.setBoolPref('skein.safeMode', false)")
        st = status(b, "ok")
        check("leaving safe mode re-applies", st and st["state"] == "ok" and navbar_bg(b) == themed_bg)

        # ------------------------------------------------------- about:skein
        page = b.chrome_async("""
          const [resolve] = arguments;
          const tab = gBrowser.addTrustedTab("about:skein");
          gBrowser.selectedTab = tab;
          const browser = tab.linkedBrowser;
          const done = () => {
            const doc = browser.contentDocument;
            resolve({
              badge: doc.getElementById("status-badge").textContent,
              dir: doc.getElementById("custom-dir").textContent,
              skills: doc.querySelectorAll("#skills-list li").length,
              history: doc.querySelectorAll("#history-list li").length,
              spaces: doc.querySelectorAll("#spaces-list li").length,
              remote: browser.isRemoteBrowser,
            });
          };
          const wait = () => (browser.contentDocument?.readyState === "complete" && browser.currentURI.spec === "about:skein" && browser.contentDocument.querySelectorAll("#history-list li").length ? done() : setTimeout(wait, 100));
          wait();
        """)
        check("about:skein shows status, folder, skills, history, spaces", page["badge"] == "Applied" and page["dir"] == CUSTOM and page["skills"] >= 1 and page["history"] >= 2 and page["spaces"] == 1, str(page))
        shot(b, "04-about-skein")
        b.chrome("gBrowser.removeTab(gBrowser.selectedTab)")

        # ------------------------------------------------------------ spaces
        r = b.chrome(SP + """
          const work = SP.createSpace("Work", { color: "green" });
          const t1 = gBrowser.selectedTab;
          SP.switchTo(window, work.id);
          const t2 = gBrowser.selectedTab;
          const out = { widget: !!document.getElementById("skein-spaces-widget"), buttons: document.querySelectorAll(".skein-space-button").length,
            newTabForEmptySpace: t1 !== t2, firstHidden: t1.hidden, attr: document.documentElement.getAttribute("skein-space"), visible: gBrowser.visibleTabs.length };
          SP.switchTo(window, SP.spaces[0].id);
          out.back = gBrowser.selectedTab === t1 && t2.hidden && !t1.hidden;
          out.workId = work.id;
          return out;
        """)
        check("spaces: switcher widget, per-space tabs, hide/show on switch", r["widget"] and r["buttons"] == 2 and r["newTabForEmptySpace"] and r["firstHidden"] and r["attr"] == "Work" and r["visible"] == 1 and r["back"], str(r))

        r = b.chrome(SP + """
          const { ContextualIdentityService: CIS } = ChromeUtils.importESModule("resource://gre/modules/ContextualIdentityService.sys.mjs");
          const id = CIS.getPublicIdentities()[0].userContextId;
          SP.updateSpace(arguments[0], { containerId: id });
          SP.switchTo(window, arguments[0]);
          BrowserCommands.openTab();
          const tab = gBrowser.selectedTab;
          const out = { want: id, got: tab.userContextId, space: SP._tabSpace(window, tab) === arguments[0] };
          SP.switchTo(window, SP.spaces[0].id);
          BrowserCommands.openTab();
          out.homeContainer = gBrowser.selectedTab.userContextId;
          return out;
        """, [r["workId"]])
        check("space bound to a container: new tabs open in it; other spaces unaffected", r["want"] == r["got"] and r["space"] and r["homeContainer"] == 0, str(r))

        # per-space skill
        enable("midnight", spaces={"Work": {"enabled": ["sunrise"]}})
        skill("sunrise", ["css"], chrome_css=":root { --skein-toolbar-bg: #ffe9c7; --skein-toolbar-fg: #3b2a10; --skein-field-bg: #fff7ea; --skein-field-fg: #2b1c05; }\n")
        st = status(b, "ok")
        home = navbar_bg(b)
        b.chrome(SP + "SP.switchTo(window, arguments[0])", [r.get("workId") or ""])
        work_id = b.chrome(SP + "return SP.spaces[1].id")
        b.chrome(SP + "SP.switchTo(window, arguments[0])", [work_id])
        work = navbar_bg(b)
        shot(b, "05-work-space")
        b.chrome(SP + "SP.switchTo(window, SP.spaces[0].id)")
        check("per-space skill set: Work space gets its own theme", home == themed_bg and work == "#ffe9c7" and navbar_bg(b) == themed_bg, f"{home} {work}")

        r = b.chrome(SP + """
          const ok = SP.deleteSpace(arguments[0]);
          return { ok, spaces: SP.spaces.length, hidden: gBrowser.tabs.filter(t => t.hidden).length, cannotDeleteLast: SP.deleteSpace(SP.spaces[0].id) === false };
        """, [work_id])
        check("deleting a space moves its tabs to the remaining space", r["ok"] and r["spaces"] == 1 and r["hidden"] == 0 and r["cannotDeleteLast"], str(r))

        # ------------------------------------------------------ privacy mode
        probe = Socks5Probe()
        probe.start()
        r = b.chrome_async(PV + """
          const [port, resolve] = arguments;
          PV.setProxy("127.0.0.1", port);
          const win = OpenBrowserWindow({ private: true });
          win.addEventListener("load", () => {
            const wait = () => (win.gBrowser && win.document.getElementById("skein-privacy-indicator") ? go() : win.setTimeout(wait, 100));
            const go = async () => {
              const browser = win.gBrowser.selectedBrowser;
              browser.fixupAndLoadURIString("http://skein-leak-test.invalid/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
              await new Promise(r => win.setTimeout(r, 4000));
              const { SkeinCustomization: C } = ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinCustomization.sys.mjs");
              resolve({
                indicator: win.document.getElementById("skein-privacy-indicator").getAttribute("value"),
                uri: browser.documentURI?.spec || "",
                skillSheet: !!C._windows.get(win)?.sheetURI,
                bg: win.getComputedStyle(win.document.documentElement).getPropertyValue("--toolbar-background-color").trim(),
                spacesWidgetButtons: win.document.querySelectorAll(".skein-space-button").length,
              });
              win.close();
            };
            wait();
          }, { once: true });
        """, [probe.port])
        check("privacy window: indicator says IP hidden", r["indicator"] == "Privacy: IP hidden", str(r))
        check("privacy window: skills are not applied", not r["skillSheet"] and r["bg"] != themed_bg, str(r))
        check("privacy window: request went to the proxy with the hostname (remote DNS)", ("domain", "skein-leak-test.invalid") in probe.requests, str(probe.requests))
        check("privacy window: proxy refusal shows an error page, no direct fallback", r["uri"].startswith(("about:neterror", "about:httpsonlyerror")), r["uri"])

        # Kill switch: proxy gone entirely.
        probe.sock.close()
        seen = len(probe.requests)
        r = b.chrome_async(PV + """
          const [resolve] = arguments;
          const win = OpenBrowserWindow({ private: true });
          win.addEventListener("load", () => {
            const wait = () => (win.gBrowser && win.document.getElementById("skein-privacy-indicator") ? go() : win.setTimeout(wait, 100));
            const go = async () => {
              const browser = win.gBrowser.selectedBrowser;
              browser.fixupAndLoadURIString("http://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
              await new Promise(r => win.setTimeout(r, 5000));
              resolve({ uri: browser.documentURI?.spec || "", title: browser.contentTitle });
              win.close();
            };
            wait();
          }, { once: true });
        """)
        check("kill switch: with the proxy down, a real site does not load", r["uri"].startswith(("about:neterror", "about:httpsonlyerror")) and "example" not in (r["title"] or "").lower(), str(r))

        r = b.chrome(PV + """
          PV.setProxy("", 0);
          return { proxy: PV.proxy, tor: !!PV.findTorBrowser() };
        """)
        check("clearing the proxy returns Privacy mode to Tor hand-off", r["proxy"] is None, str(r))

        # standard windows unaffected by the proxy
        r = b.chrome(PV + """
          PV.setProxy("127.0.0.1", 9);
          const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
          const mk = priv => { const ch = NetUtil.newChannel({ uri: "http://example.com/", loadUsingSystemPrincipal: true }); ch.QueryInterface(Ci.nsIPrivateBrowsingChannel).setPrivate(priv); return ch; };
          const out = {};
          for (const priv of [false, true]) { PV.applyFilter(mk(priv), null, { onProxyFilterResult(pi) { out[priv] = pi ? pi.type + ":" + pi.host + ":" + pi.port + ":" + (pi.flags & 1) : null; } }); }
          PV.setProxy("", 0);
          return out;
        """)
        check("proxy filter: standard channels direct, private channels SOCKS with remote DNS", r.get("false") is None and r.get("true") == "socks:127.0.0.1:9:1", str(r))

    # ------------------------------------- spaces survive quit and restore
    prefs = {"browser.startup.page": 3}
    prof = os.path.join(TMP, "profile-restore")
    b = Browser(BINARY, prof, headless=not HEADED, env=env, prefs=prefs)
    b.chrome(SP + """
      const sys = { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() };
      gBrowser.selectedBrowser.fixupAndLoadURIString("about:robots", sys);
      gBrowser.addTrustedTab("about:license");
      const work = SP.createSpace("Work");
      SP.switchTo(window, work.id);
      gBrowser.selectedBrowser.fixupAndLoadURIString("about:logo", sys);
      gBrowser.addTrustedTab("about:mozilla");
    """)
    time.sleep(3)
    try:
        b.cmd("Marionette:Quit", {"flags": ["eAttemptQuit"]})
    except Exception:
        pass
    b.proc.wait(timeout=30)
    with Browser(BINARY, prof, headless=not HEADED, env=env, prefs=prefs) as b:
        time.sleep(5)
        r = b.chrome(SP + """
          return { active: SP.activeSpaceName(window),
                   tabs: gBrowser.tabs.map(t => [t.linkedBrowser.currentURI.spec, SP.getSpace(SP._tabSpace(window, t)).name, t.hidden]) };
        """)
        want = [["about:robots", "Home", True], ["about:license", "Home", True], ["about:logo", "Work", False], ["about:mozilla", "Work", False]]
        check("spaces survive quit and session restore", r["active"] == "Work" and r["tabs"] == want, str(r))


    # Zen-style focus features (SkeinFocus.sys.mjs)
    prof2 = os.path.join(TMP, "profile-focus")
    with Browser(BINARY, prof2, headless=not HEADED, env=env) as b:
        time.sleep(4)
        r = b.chrome("return [document.getElementById('nav-bar').parentNode.id, document.documentElement.hasAttribute('skein-sidebar-toolbar')]")
        check("focus: navigation toolbar lives in the sidebar with vertical tabs", r == ["sidebar-container", True], str(r))
        b.chrome("document.getElementById('cmd_newNavigatorTabNoEvent').doCommand()")
        time.sleep(0.5)
        r = b.chrome("return [document.documentElement.hasAttribute('skein-newtab-mode'), gURLBar.focused, gURLBar.value, gBrowser.tabs.length]")
        check("focus: Ctrl+T floats the real address bar, empty, without opening a tab yet", r == [True, True, "", 1], str(r))
        b.chrome("gURLBar.value='about:robots'; gURLBar.handleCommand(new KeyboardEvent('keydown',{key:'Enter'}))")
        time.sleep(2)
        r = b.chrome("return gBrowser.tabs.map(t => t.linkedBrowser.currentURI.spec)")
        check("focus: floating bar opens what you typed (on the empty start page it replaces it)", r[-1] == "about:robots" and len(r) in (1, 2), str(r))
        b.chrome("for (const t of [...gBrowser.tabs]) gBrowser.removeTab(t, {animate: false});")
        time.sleep(2)
        r = b.chrome("return [[...Services.wm.getEnumerator('navigator:browser')].length, gBrowser.tabs.map(t => [t.linkedBrowser.currentURI.spec, t.hasAttribute('skein-empty')])]")
        check("focus: closing the last tab keeps the window and shows the empty page", r == [1, [["chrome://browser/content/skein/empty.html", True]]], str(r))
        b.chrome("BrowserCommands.openTab({url: 'about:mozilla'})")
        time.sleep(2)
        r = b.chrome("return gBrowser.tabs.map(t => [t.linkedBrowser.currentURI.spec, t.hasAttribute('skein-empty')])")
        check("focus: opening a tab from the empty page replaces the placeholder", r == [["about:mozilla", False]], str(r))
        b.chrome("document.getElementById('sidebar-button').doCommand()")
        time.sleep(0.3)
        r = b.chrome("return document.documentElement.hasAttribute('skein-sidebar-hidden')")
        b.chrome("document.getElementById('sidebar-button').doCommand()")
        check("focus: sidebar button slides the sidebar out", r is True, str(r))
        r = b.chrome("return navigator.userAgent")
        check("user agent reports Firefox so sites serve their full pages", "Firefox/" in r and "Skein" not in r, r)
        r = b.chrome("return ['sidebar-button', 'back-button', 'forward-button', 'stop-reload-button'].map(id => Math.round(document.getElementById(id)?.getBoundingClientRect().x ?? -1))")
        check("focus: sidebar toolbar shows sidebar, back, forward, reload in that order", r[0] >= 0 and r == sorted(r) and len(set(r)) == 4, str(r))
        r = b.chrome("return [...document.getElementById('widget-overflow-list').children].map(c => c.id)")
        check("focus: nothing (Spaces included) is pushed into the >> overflow menu", "skein-spaces-widget" not in r, str(r))
        b.chrome("Services.prefs.setBoolPref('skein.focus.compact', true)")
        time.sleep(1.2)
        r = b.chrome("let e = document.getElementById('sidebar-container'), c = e.getBoundingClientRect(); return [Math.round(e.hasAttribute('sidebar-positionend') ? c.left : c.right), getComputedStyle(gURLBar).opacity]")
        b.chrome("Services.prefs.setBoolPref('skein.focus.compact', false)")
        check("focus: compact mode slides the whole sidebar, toolbar included, off screen", (r[0] <= 8 or r[0] >= 1272) and r[1] == "0", str(r))
        r = b.chrome("const t = gBrowser.selectedTab; return getComputedStyle(t.querySelector('.tab-close-button')).visibility")
        check("tabs: close button is hidden until hover (Zen)", r == "hidden", r)
        r = b.chrome("const bar = document.getElementById('skein-topbar'); return [!!bar, Math.round(bar.getBoundingClientRect().bottom) <= 6, bar.querySelectorAll('button').length]")
        check("top bar: present, tucked away until hover, with three window buttons", r == [True, True, 3], str(r))
        b.chrome("const {SkeinFocus} = ChromeUtils.importESModule('moz-src:///browser/components/skein/SkeinFocus.sys.mjs'); gBrowser.addTrustedTab('about:robots'); SkeinFocus.toggleSplit(window)")
        time.sleep(1)
        r = b.chrome("return [!!gBrowser.selectedTab.splitview, gBrowser.tabpanels.hasAttribute('splitview')]")
        b.chrome("const {SkeinFocus} = ChromeUtils.importESModule('moz-src:///browser/components/skein/SkeinFocus.sys.mjs'); SkeinFocus.toggleSplit(window)")
        time.sleep(0.5)
        r2 = b.chrome("return !!gBrowser.selectedTab.splitview")
        check("split view: Ctrl+Alt+V splits the tab and separates it again", r == [True, True] and r2 is False, f"{r} {r2}")
        S = "const {SkeinSpaces} = ChromeUtils.importESModule('moz-src:///browser/components/skein/SkeinSpaces.sys.mjs');"
        r = b.chrome(S + """
          const P = Services.scriptSecurityManager.getSystemPrincipal();
          const home = SkeinSpaces.activeSpace(window).id;
          const ess = gBrowser.addTab('about:logo', {triggeringPrincipal: P}); gBrowser.pinTab(ess);
          const other = SkeinSpaces.createSpace('Second');
          SkeinSpaces.switchTo(window, other.id);
          const hiddenInOther = getComputedStyle(ess).display === 'none';
          SkeinSpaces.switchTo(window, home);
          const shownAtHome = getComputedStyle(ess).display !== 'none';
          SkeinSpaces.deleteSpace(other.id);
          return [hiddenInOther, shownAtHome];""")
        check("spaces: Essentials belong to their space", r == [True, True], str(r))
        b.chrome("Services.prefs.setBoolPref('skein.ui.topSearchBar', true)")
        time.sleep(0.5)
        r = b.chrome("return document.getElementById('nav-bar').parentNode.id")
        b.chrome("Services.prefs.setBoolPref('skein.ui.topSearchBar', false)")
        check("focus: skein.ui.topSearchBar puts the address bar back on top", r == "navigator-toolbox", str(r))
        import http.server, threading
        www = os.path.join(TMP, "www"); os.makedirs(www, exist_ok=True)
        open(os.path.join(www, "index.html"), "w").write('<a id="l" href="/two.html" style="display:block;font-size:40px">Link</a>')
        open(os.path.join(www, "two.html"), "w").write("<h1>two</h1>")
        handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=www, **k)
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]
        b.chrome(f"gBrowser.selectedTab = gBrowser.addTab('http://127.0.0.1:{port}/', {{triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()}})")
        time.sleep(2)
        b.chrome("""const r = gBrowser.selectedBrowser.getBoundingClientRect(); const x = r.left + 30, y = r.top + 30;
          const o = {isDOMEventSynthesized: false, isAsyncEnabled: true};
          window.synthesizeMouseEvent('mousemove', x, y, {}, o);
          window.synthesizeMouseEvent('mousedown', x, y, {button: 0, clickCount: 1, modifiers: Event.ALT_MASK}, o);
          window.synthesizeMouseEvent('mouseup', x, y, {button: 0, clickCount: 1, modifiers: Event.ALT_MASK}, o);""")
        time.sleep(2)
        r = b.chrome("return [document.documentElement.hasAttribute('skein-glance-open'), gBrowser.selectedBrowser.currentURI.spec.endsWith('/two.html')]")
        check("glance: Alt+click on a web link opens it in Glance", r == [True, True], str(r))
        b.chrome("ChromeUtils.importESModule('moz-src:///browser/components/skein/SkeinFocus.sys.mjs').SkeinFocus.closeGlance(window)")
        httpd.shutdown()
        G = "const {SkeinFocus} = ChromeUtils.importESModule('moz-src:///browser/components/skein/SkeinFocus.sys.mjs'); const sys = Services.scriptSecurityManager.getSystemPrincipal();"
        before = b.chrome("return gBrowser.tabs.length")
        b.chrome(G + "SkeinFocus.openGlance(window, 'about:robots', sys)")
        time.sleep(2)
        r1 = b.chrome("return [document.documentElement.hasAttribute('skein-glance-open'), gBrowser.selectedBrowser.currentURI.spec, !!document.getElementById('skein-context-glance')]")
        b.chrome(G + "SkeinFocus.closeGlance(window)")
        time.sleep(1)
        r2 = b.chrome("return [document.documentElement.hasAttribute('skein-glance-open'), gBrowser.tabs.length]")
        check("focus: Glance opens a link in a floating card and Esc/Close returns", r1 == [True, "about:robots", True] and r2 == [False, before], str([r1, r2]))
        r = b.chrome("return Services.prefs.getBoolPref('browser.ctrlTab.sortByRecentlyUsed')")
        check("focus: Ctrl+Tab uses recently-used order", r is True, str(r))

    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(1 if failed else 0)


main()
