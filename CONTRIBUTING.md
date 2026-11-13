# Contributing to Skein

Thanks for looking. Skein is a small project with a narrow goal: a Gecko
browser whose interface a local AI agent can customize safely.

## Ground rules

1. **Security rules are not negotiable.** Do not weaken the validator, the
   runtime integrity check, the preference allowlist or the Privacy mode
   guarantees to make a feature easier. If something conflicts, open an issue.
2. **No Zen code.** Spaces, folders and the rest are Skein's own implementation
   or upstream Firefox features. Do not copy or port code from Zen Browser.
3. **No Mozilla or Zen trademarks** (names, logos) in the product.
4. **Keep the upstream diff tiny.** New code goes in `skein/` (an overlay of
   new files). Edits to Firefox's own files go in `patches/` and must be
   listed in `PATCHES.md` with the reason. Prefer category-manager hooks and
   new files over patches.
5. MPL 2.0. Keep the licence header on MPL files.

## Layout

    docs/            plan, reports, format and process documentation
    skein/           overlay copied onto the Firefox tree (new files only)
    patches/         edits to upstream files, applied by scripts/apply.sh
    mozconfigs/      build configurations
    branding-src/    logo sources and default preferences
    scripts/         apply, branding, stable-surface check, packaging
    engine/          the Firefox ESR checkout (not in this repository)

## Building

See `docs/build-linux.md` (tested) and `docs/build-windows.md`.

## Tests

    node --test skein/tests/validator/          # validator, adversarial suite
    node scripts/check-stable-surface.mjs       # stable surface vs. the tree
    python3 scripts/dev/test_skein.py           # end-to-end against a real build (headless)

Every change to `SkeinValidator.sys.mjs` needs a test. If you find a bypass,
add it to the adversarial suite first, then fix it.

## Changing the stable surface

`SkeinSurface.sys.mjs` lists the tokens and regions skills rely on. Removing or
renaming an entry breaks users' skills: map the old name to the new one, bump
`SURFACE_VERSION`, and note it in `docs/surface-changelog.md`.
