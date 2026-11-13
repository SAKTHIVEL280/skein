#!/usr/bin/env python3
"""Minimal Marionette client for driving a Skein/Firefox build in tests.

Usage as a library:
    from mn import Browser
    with Browser(binary, profile_dir, headless=True) as b:
        b.chrome("return Services.appinfo.version")
        b.screenshot("out.png")
"""
import base64, json, os, socket, subprocess, sys, time


class Browser:
    def __init__(self, binary, profile, headless=True, port=2828, args=(), env=None, prefs=None):
        self.binary, self.profile, self.port = binary, profile, port
        os.makedirs(profile, exist_ok=True)
        user_js = {
            "marionette.port": port,
            "browser.shell.checkDefaultBrowser": False,
            "browser.aboutwelcome.enabled": False,
            "datareporting.policy.dataSubmissionEnabled": False,
            "browser.startup.homepage_override.mstone": "ignore",
            "toolkit.startup.max_resumed_crashes": -1,
            "browser.sessionstore.resume_from_crash": False,
            "browser.tabs.warnOnClose": False,
            "browser.warnOnQuit": False,
            "devtools.chrome.enabled": True,
        }
        user_js.update(prefs or {})
        with open(os.path.join(profile, "user.js"), "w") as f:
            for k, v in user_js.items():
                f.write(f"user_pref({json.dumps(k)}, {json.dumps(v)});\n")
        e = dict(os.environ)
        if headless:
            e["MOZ_HEADLESS"] = "1"
            e["MOZ_HEADLESS_WIDTH"] = "1280"
            e["MOZ_HEADLESS_HEIGHT"] = "800"
        e.update(env or {})
        self.proc = subprocess.Popen(
            [binary, "--marionette", "-remote-allow-system-access", "--no-remote", "--profile", profile, *args],
            env=e, stdout=subprocess.DEVNULL, stderr=open(os.path.join(profile, "stderr.log"), "w"))
        self.sock = None
        self.mid = 0
        deadline = time.time() + 90
        while time.time() < deadline:
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=120)
                break
            except OSError:
                time.sleep(0.3)
        if not self.sock:
            self.proc.kill()
            raise RuntimeError("marionette did not come up")
        try:
            self._recv()  # hello
            self.cmd("WebDriver:NewSession", {"capabilities": {}})
            self.cmd("Marionette:SetContext", {"value": "chrome"})
        except Exception:
            self.proc.kill()
            raise

    def _recv(self):
        buf = b""
        while b":" not in buf:
            buf += self.sock.recv(1)
        n, _, rest = buf.partition(b":")
        n = int(n)
        while len(rest) < n:
            rest += self.sock.recv(n - len(rest))
        return json.loads(rest)

    def cmd(self, name, params=None):
        self.mid += 1
        msg = json.dumps([0, self.mid, name, params or {}])
        self.sock.sendall(f"{len(msg)}:{msg}".encode())
        typ, mid, err, res = self._recv()
        if err:
            raise RuntimeError(f"{name}: {err.get('message')}")
        return res.get("value") if isinstance(res, dict) and "value" in res else res

    def chrome(self, script, args=()):
        return self.cmd("WebDriver:ExecuteScript", {"script": script, "args": list(args), "sandbox": "system"})

    def chrome_async(self, script, args=(), timeout=60000):
        """script receives `resolve` as its last argument."""
        self.cmd("WebDriver:SetTimeouts", {"script": timeout})
        return self.cmd("WebDriver:ExecuteAsyncScript", {"script": script, "args": list(args), "sandbox": "system"})

    def screenshot(self, path):
        data = self.cmd("WebDriver:TakeScreenshot", {"full": False})
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))

    def close(self):
        try:
            self.cmd("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
        try:
            self.proc.wait(timeout=20)
        except Exception:
            self.proc.kill()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
