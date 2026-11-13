# Phase 0 report: build pipeline and the live-edit bet

Date: 2026-11-13/14. Machine: Arch Linux (Omarchy), x86_64, 16 threads, 32 GB RAM.

**Recommendation: go.** The core bet holds: the browser interface can be
changed by editing CSS and structured files only, live, with no rebuild and no
restart. Two caveats: everything here was done on Linux, not the Windows
laptop the plan assumed, and the optimized release build has not been
completed, so the performance gate is only half answered.

## What was verified

| Plan item | Result |
|---|---|
| Current ESR | **153.7.0esr** (Mozilla product-details, 2026-11-13). Source: tag `FIREFOX_153_7_0esr_RELEASE` on `github.com/mozilla-firefox/firefox`. |
| Firefox UI is HTML/XUL/CSS/JS | Confirmed. Skein's whole feature set is JS modules and CSS; the only C++ touched is one table entry for `about:skein`. |
| Custom UI CSS needs a pref and a restart | True for `userChrome.css`, but irrelevant: `windowUtils.loadSheetUsingURIString` applies a stylesheet to a running window instantly. Skein uses that. |
| Vertical tabs / tab groups / split view upstream | All three ship in ESR 153 (`sidebar.verticalTabs`, `browser.tabs.groups.enabled`, `browser.tabs.splitView.enabled`). Skein reuses them. Spaces are Skein's own. |
| Containers | Inherited (`ContextualIdentityService`). Spaces can bind to one. |
| Old theme variable names | Several classic ones (`--toolbar-bgcolor`, `--tab-selected-bgcolor`, `--arrowpanel-background`) no longer exist in 153. This is exactly the breakage the stable-surface layer is for; Skein exposes its own `--skein-*` tokens. |
| MPL 2.0 | Confirmed; licence text in `LICENSE`, headers kept. |

## Commands and timings

```sh
git clone --depth 1 --branch FIREFOX_153_7_0esr_RELEASE https://github.com/mozilla-firefox/firefox engine   # 5.6 GB on disk
cd engine
./mach --no-interactive bootstrap --application-choice browser      # 4 min 10 s
./mach build                                                        # stock, optimized, non-PGO
```

| Step | Time |
|---|---|
| Bootstrap (toolchain download) | 4 min 10 s |
| Full stock build | about 25 min (interrupted once near the end; resumed in 31 s) |
| Full Skein build after rebranding (reconfigure forces a near-full rebuild) | 23 min 25 s |
| No-op rebuild | 31 s |
| Front-end-only rebuild (`./mach build faster`) after editing Skein JS/CSS | **about 2 s** |
| Disk: source / build output / toolchains | 5.6 GB / 15 GB / about 3 GB |

## The live-edit proof

On the **stock** build, driven over Marionette:

- Injecting a stylesheet changed the toolbar's computed background from
  `rgb(255, 255, 255)` to `rgb(91, 42, 134)` in **0.5 ms**, no restart.
- Flipping `sidebar.revamp` + `sidebar.verticalTabs` moved the tab strip to a
  vertical sidebar live.

On the **Skein** build, end to end (`scripts/dev/demo.py`): writing three files
into the customization folder (theme, layout, manifest) re-themed the browser,
moved vertical tabs to the right and restyled the top bar **1.2 s** after the
files were written (1 s of that is the folder poll). Rolling back restored the
stock look. Screenshots: `docs/img/demo-*.png`.

## Performance gate

Speedometer 3.1, headless (software rendering for both, so only the ratio
means anything), same machine, one run each:

| Build | Score |
|---|---|
| Official Firefox ESR 153.7.0 (Mozilla's PGO + LTO binary) | 22.6 |
| Skein developer build (`--enable-optimize --enable-release`, **no PGO, no LTO**) | 17.2 (24% lower) |

The gap is the expected size for a build without profile-guided and link-time
optimization, which Mozilla's binary has and this one does not. That is an
inference, not a measurement: the release configuration
(`mozconfigs/release.mozconfig`, LTO + PGO) was started but the build was
stopped about 22 minutes in when the system ran low on memory, and it has not
been re-run. **Until a PGO build is benchmarked, "Skein is as fast as stock"
is unproven.** Skein's own code adds a 1-second folder poll and a stylesheet;
neither is on a page-load path.

Startup, process start to first paint, headless, fresh profile, median of 5:

| Build | Time |
|---|---|
| Official Firefox ESR 153.7.0 | 564 ms |
| Skein developer build | 642 ms (14% slower) |

Not measured: memory with 30 tabs, JetStream, the author's ten most-used
sites, and anything with a real GPU.

## What failed or needed fixing along the way

- Marionette needs `-remote-allow-system-access` to script the browser chrome.
- The first integrity check design estimated the address bar's background from
  CSS; in this Firefox the background is painted by a sibling box and by
  `background-image`, so the estimate was wrong. It now reads rendered pixels.
- An overlay positioned from the toolbar does not cover the page or the
  address bar in this Firefox (the address bar is in the top layer, the page
  area has its own stacking context). Overlays from direct children of the
  window do; those are what the integrity check's hit-testing catches.
- Spaces were lost across restart until tab assignment was moved to after
  session restore attaches its saved data.
- Hard-coded "Firefox" strings exist outside the brand terms (network error
  pages, the "Firefox Suggest" label); `scripts/apply.sh` rewrites those two.

## Not done in Phase 0

- **Windows.** No Windows build exists. Cross-compiling from Linux got as far
  as downloading the Windows SDK; unpacking needs `msitools`.
- **DRM / Widevine: partly verified.** On the Skein build the Widevine CDM
  (4.10.3112.0) downloaded on first use and
  `navigator.requestMediaKeySystemAccess("com.widevine.alpha")` followed by
  `createMediaKeys()` succeeded. Actual playback on Netflix or similar has not
  been tested (it needs an account and a real display).
- **PGO/LTO release build and its benchmark** (see above).

## Go / no-go

| Gate | Status |
|---|---|
| Build pipeline works, rebuilds are fast | Pass (Linux) |
| UI changes without a full rebuild | Pass: live, sub-second |
| Performance not clearly worse than stock | **Open**: dev build is 24% behind; release build not yet measured |

Go, with the performance gate to be closed by one PGO build and benchmark
before any public release.
