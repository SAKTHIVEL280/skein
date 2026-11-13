# Building Skein on Linux

Tested on Arch Linux (Omarchy), x86_64, 16 threads, 32 GB RAM, on 2026-11-13.

## Requirements

- About 40 GB free disk (5.6 GB source checkout, ~15 GB build output, ~3 GB toolchains in `~/.mozbuild`).
- git, Python 3.9–3.12 (mach picks a supported version itself), a Rust toolchain (rustup), clang.
- For branding regeneration only: `rsvg-convert` (librsvg) and ImageMagick.

## Steps

```sh
git clone https://github.com/SAKTHIVEL280/skein && cd skein

# 1. Firefox ESR source (shallow clone of the release tag, ~5.6 GB on disk)
git clone --depth 1 --branch FIREFOX_153_7_0esr_RELEASE https://github.com/mozilla-firefox/firefox engine

# 2. Toolchains (downloads to ~/.mozbuild; about 4 minutes)
cd engine && ./mach --no-interactive bootstrap --application-choice browser && cd ..

# 3. Skein overlay, patches and mozconfig
scripts/apply.sh

# 4. Build and run
cd engine
./mach build
./mach run            # or ../obj-skein/dist/bin/skein
```

## Day-to-day

| Task | Command | Time on the test machine |
|---|---|---|
| Full build from scratch | `./mach build` | about 25 min |
| No-op rebuild | `./mach build` | 31 s |
| Front-end only change (JS/CSS/HTML in `browser/`) | `./mach build faster` | see `docs/phase0-report.md` |
| Package a distributable archive | `./mach package` | |

Skein's own files live in `skein/` in this repository and are copied into
`engine/` by `scripts/apply.sh`. If you edit them inside `engine/`, run
`scripts/sync-from-engine.sh` to copy them back before committing.

## Tests

```sh
node --test skein/tests/validator/           # validator adversarial suite (no build needed)
node scripts/check-stable-surface.mjs        # stable surface vs. the Firefox tree
python3 scripts/dev/test_skein.py            # end-to-end, headless, throwaway profile
```
