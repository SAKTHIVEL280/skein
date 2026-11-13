#!/usr/bin/env python3
"""Flagship demo, scripted: an "agent" (this script, following SKILL.md)
redesigns the browser from files alone, then the change is rolled back.
Writes screenshots to docs/img/.

    python3 scripts/dev/demo.py [path-to-binary]
"""
import json, os, shutil, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mn import Browser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BINARY = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "obj-skein", "dist", "bin", "skein")
OUT = os.path.join(ROOT, "docs", "img")
TMP = tempfile.mkdtemp(prefix="skein-demo-")
CUSTOM = os.path.join(TMP, "config", "skein-customization", "custom")

AURORA_CSS = """\
/* "Give me a calm teal look, tabs on the right, and a roomier top bar." */
:root {
  --skein-chrome-bg: #0f1c1f;
  --skein-chrome-fg: #dcefee;
  --skein-toolbar-bg: #13272b;
  --skein-toolbar-fg: #dcefee;
  --skein-field-bg: #1c383d;
  --skein-field-fg: #f2fbfa;
  --skein-field-border: #2b5057;
  --skein-accent: #2fd4c4;
  --skein-tab-selected-bg: #1f4046;
  --skein-sidebar-bg: #0f1c1f;
  --skein-sidebar-fg: #dcefee;
  --skein-panel-bg: #13272b;
  --skein-panel-fg: #dcefee;
  --skein-radius: 14px;
}

/* A different top bar: taller, with a pill-shaped address bar. */
#nav-bar {
  padding-block: 6px;
  border-bottom: 1px solid #2b5057;
}

.urlbar-background {
  border-radius: 18px;
}

.tabbrowser-tab[selected] .tab-label {
  font-weight: 600;
}
"""


def wait_state(want, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = json.load(open(os.path.join(CUSTOM, ".status.json")))
            if st["state"] == want:
                return st
        except Exception:
            pass
        time.sleep(0.3)
    raise SystemExit(f"timed out waiting for state {want}")


def shot(b, name):
    time.sleep(4)
    b.screenshot(os.path.join(OUT, name))
    print("wrote", os.path.join("docs/img", name))


with Browser(BINARY, os.path.join(TMP, "profile"), env={"XDG_CONFIG_HOME": os.path.join(TMP, "config")}, prefs={"ui.systemUsesDarkTheme": 1}) as b:
    wait_state("empty")
    # Hide the "browser is under remote control" cue that Marionette adds.
    b.chrome("document.documentElement.removeAttribute('remotecontrol'); gBrowser.selectedBrowser.fixupAndLoadURIString('https://example.com/', {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()}); gBrowser.addTrustedTab('about:skein');")
    time.sleep(3)
    shot(b, "demo-1-stock.png")

    # The agent's entire job: write three files.
    skill = os.path.join(CUSTOM, "skills", "aurora")
    os.makedirs(skill)
    json.dump({"id": "aurora", "name": "Aurora", "description": "Calm teal theme, tabs on the right, roomier top bar.", "version": "1.0.0", "touches": ["css", "layout"]}, open(os.path.join(skill, "skill.json"), "w"), indent=2)
    open(os.path.join(skill, "chrome.css"), "w").write(AURORA_CSS)
    json.dump({"tabs": {"orientation": "vertical", "side": "right"}, "density": "normal"}, open(os.path.join(skill, "layout.json"), "w"), indent=2)
    json.dump({"formatVersion": 1, "enabled": ["aurora"]}, open(os.path.join(CUSTOM, "skein.json"), "w"), indent=2)
    t0 = time.time()
    st = wait_state("ok")
    print("applied live in %.1fs (includes the 1s folder poll): %s" % (time.time() - t0, st["enabled"]))
    shot(b, "demo-2-redesigned.png")

    b.chrome("gBrowser.selectedTab = gBrowser.tabs[gBrowser.tabs.length - 1]")
    shot(b, "demo-3-about-skein.png")

    b.chrome_async('const [resolve] = arguments; ChromeUtils.importESModule("moz-src:///browser/components/skein/SkeinCustomization.sys.mjs").SkeinCustomization.rollbackToPrevious().then(resolve);')
    wait_state("empty")
    b.chrome("gBrowser.selectedTab = gBrowser.tabs[0]")
    shot(b, "demo-4-rolled-back.png")
shutil.rmtree(TMP, ignore_errors=True)
