# Privacy defaults

Defaults live in `branding-src/firefox-branding.js` (installed as the branding
preference file) and in the build configuration. Every preference name was
checked against the Firefox ESR 153.7.0 source; `scripts/check-stable-surface.mjs`
and the end-to-end test assert a sample of them at runtime.

## Build level

| Setting | Effect |
|---|---|
| `--disable-crashreporter` | No crash reports are collected or sent. |
| `--disable-updater` | No update pings to Mozilla. (Also means no automatic updates yet: see `docs/release.md`.) |
| `MOZ_NORMANDY` off (patch 0004) | The remote studies/experiments client is not built. |
| Unofficial branding, no `MOZ_TELEMETRY_REPORTING` | Telemetry upload is compiled out of non-official builds. |

## Preferences

- **Telemetry and studies off:** `datareporting.*uploadEnabled`,
  `toolkit.telemetry.*`, `app.shield.optoutstudies.enabled`,
  `app.normandy.enabled`, `nimbus.rollouts.enabled`, crash-report submission.
- **Sponsored content and promotions off:** sponsored shortcuts and stories on
  the new tab page, sponsored and "nonsponsored" online suggestions in the
  address bar, add-on recommendations, VPN/Focus promos, "More from Mozilla".
- **No built-in AI:** `browser.ml.chat.enabled`, `browser.ml.enable` off.
- **Tracking protection:** `browser.contentblocking.category` = `strict`
  (includes total cookie protection).
- **HTTPS-only mode on.**
- **Less speculative network activity:** DNS prefetch, link prefetch and
  speculative connections off.
- **WebRTC:** local (host) addresses are never exposed; when a page was loaded
  through a proxy, WebRTC may only use that proxy.

## What still contacts Mozilla or third parties

Stated plainly, because "no telemetry" is not "no network":

- **Safe Browsing** list updates (Google-provided lists, fetched through
  Mozilla's configuration). Kept on: turning it off removes phishing and
  malware protection.
- **Remote settings** (certificate revocation lists, tracking-protection
  lists, blocklists) from Mozilla's servers. Kept on: these are security data.
- **Add-ons** from addons.mozilla.org when you install or update extensions.
- **Widevine** (DRM) is downloaded from Mozilla/Google servers the first time
  it is needed. The CDM loads and creates media keys on Skein; playback on a
  real streaming service has not been tested yet.
- **Captive-portal and connectivity checks** (`detectportal.firefox.com`).
- **Search suggestions** go to your search provider as you type.
- **Firefox Sync / Mozilla accounts** remain available if you choose to sign in.

Each of these can be turned off in Settings or `about:config`. Review them
before a public release; references worth studying are LibreWolf and Mullvad
Browser.
