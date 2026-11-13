#!/usr/bin/env python3
"""Compare a Skein build against a reference Firefox on this machine.

    python3 scripts/dev/bench.py <binary> [<binary> ...]

Measures cold-ish startup (process start to first paint, 5 runs, median) and
Speedometer 3.1 (headless, so both use software rendering: compare the two
numbers with each other, not with published scores).
"""
import os, shutil, statistics, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mn import Browser


def startup(binary):
    times = []
    for _ in range(5):
        tmp = tempfile.mkdtemp(prefix="bench-")
        with Browser(binary, tmp + "/p", env={"XDG_CONFIG_HOME": tmp + "/c"}) as b:
            time.sleep(2)
            time.sleep(2)
            info = b.chrome("const i = Services.startup.getStartupInfo(); const p = i.firstPaint2 || i.firstPaint; return [i.process.getTime(), p ? p.getTime() : 0]")
            if info[1]:
                times.append(info[1] - info[0])
        shutil.rmtree(tmp, ignore_errors=True)
    return statistics.median(times) if times else None


def speedometer(binary):
    tmp = tempfile.mkdtemp(prefix="bench-")
    try:
        with Browser(binary, tmp + "/p", env={"XDG_CONFIG_HOME": tmp + "/c"}) as b:
            b.cmd("Marionette:SetContext", {"value": "content"})
            b.cmd("WebDriver:Navigate", {"url": "https://browserbench.org/Speedometer3.1/?startAutomatically=true"})
            deadline = time.time() + 900
            while time.time() < deadline:
                time.sleep(10)
                score = b.cmd("WebDriver:ExecuteScript", {"script": "const e = document.querySelector('#result-number'); return e && e.textContent.trim();", "args": []})
                if score:
                    return float(score)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return None


for binary in sys.argv[1:]:
    print(binary)
    print("  startup to first paint (median of 5): %s ms" % startup(binary))
    print("  Speedometer 3.1 (headless): %s" % speedometer(binary))
