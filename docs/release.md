# Updates and releases

## Policy

- Skein tracks the **Firefox ESR** line (currently 153). Every upstream ESR
  point release carries security fixes; the goal is to ship a Skein build
  within a few days of each one.
- Updates are **never** merged or released automatically. A person reviews,
  builds and tests each one.
- Until an update server exists, Skein has the built-in updater disabled
  (`--disable-updater`) and updates are manual downloads from GitHub Releases.
  This is the biggest gap before a public alpha: users will not be told about
  security updates by the browser itself.

## Detecting a new ESR

`.github/workflows/esr-watch.yml` runs weekly. When Mozilla's product-details
service reports an ESR newer than `BASE_VERSION` in `SkeinSurface.sys.mjs`, it
sparse-checks-out the new tag, tests whether `patches/` still apply, runs the
stable-surface check and opens an issue with the report.

## Shipping an update (maintainer's machine)

1. Rebase: follow "Rebasing onto a new ESR release" in `PATCHES.md`.
2. Build: `MOZCONFIG=../mozconfigs/release.mozconfig ./mach build` for a
   release (LTO + PGO), or the default mozconfig for a quick check.
3. Test: `node --test skein/tests/validator/`,
   `node scripts/check-stable-surface.mjs`,
   `python3 scripts/dev/test_skein.py`. Then use the build for a day.
4. If the stable surface changed, bump `SURFACE_VERSION`, update the token
   maps, and note the change for agents in `docs/surface-changelog.md`.
   `SKILL.md` is regenerated from those tables on each user's machine.
5. Package: `./mach package` (archive in `obj-skein/dist/`).
6. Publish: GitHub Release with the archive and its SHA-256 checksums.

## After an update, on the user's machine

Skein re-validates the customization folder on every start. Skills whose
selectors no longer match anything are listed as warnings in `about:skein`,
and a bundle that now fails the integrity check is not applied; History in
`about:skein` restores the last working snapshot.

## Signing

Windows builds are unsigned until a code-signing certificate is funded.
SmartScreen will warn about an unknown publisher. Each release lists SHA-256
checksums so downloads can be verified, and the build is reproducible from
source with the documented commands.

## Not done yet

- Update server and in-browser update notifications.
- Code signing (Windows), notarization (macOS).
- Release builds with PGO have not been produced or benchmarked yet.
