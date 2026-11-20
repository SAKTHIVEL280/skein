# Building Skein for Windows

> **Cross-compiled, not yet run on Windows.** Option B below produces an installer.
> These steps follow Mozilla's documented Windows build process plus Skein's
> overlay; expect to fix small things the first time through, and please
> record what you changed.

## Option A: build on Windows

Requirements (from Mozilla's Windows build documentation, `engine/docs/setup/windows_build.rst`):
64-bit Windows 10 or later, 40 GB+ free disk, 16 GB+ RAM recommended. An
i7-11800H with 32 GB RAM is comfortably above this.

1. Install **MozillaBuild** (Mozilla's shell and tool bundle) and open its
   `start-shell.bat`. All commands below run in that shell.
2. Get the sources:

   ```sh
   cd /c/
   git clone https://github.com/SAKTHIVEL280/skein && cd skein
   git clone --depth 1 --branch FIREFOX_153_7_0esr_RELEASE https://github.com/mozilla-firefox/firefox engine
   ```

   Keep the path short and outside OneDrive or other synced folders.
3. Toolchains (installs Visual Studio Build Tools components, Rust, clang):

   ```sh
   cd engine && ./mach --no-interactive bootstrap --application-choice browser && cd ..
   ```

4. Apply Skein and build:

   ```sh
   scripts/apply.sh
   cd engine
   ./mach build
   ./mach run
   ./mach package          # produces a .zip and installer under ../obj-skein/dist/
   ```

Things to check on the first Windows build:

- `scripts/apply.sh` picks `mozconfigs/windows.mozconfig` by `uname`; confirm
  it selected the right file (`cat engine/mozconfig`).
- The customization folder should be `%APPDATA%\SkeinCustomization\custom`.
- Tor Browser detection looks for `Desktop\Tor Browser\Browser\firefox.exe`.
- The installer strings come from `browser/branding/skein/branding.nsi`; a
  few stub-installer URLs there still point at mozilla.org and are unused
  because Skein does not ship a stub installer.
- Run `python scripts/dev/test_skein.py ..\obj-skein\dist\bin\skein.exe`.
  The test sets `XDG_CONFIG_HOME`, which Windows ignores, so it will use the
  real `%APPDATA%\SkeinCustomization` folder: run it on a machine where that is empty.

## Option B: cross-compile from Linux

Mozilla's build system can produce Windows binaries on Linux using clang-cl
and a copy of the Windows SDK:

```sh
# needs msitools (msiextract) installed
cd engine
./mach python --virtualenv build taskcluster/scripts/misc/get_vs.py build/vs/vs2026.yaml ~/.mozbuild/vs
rustup target add x86_64-pc-windows-msvc
```

then build with the ready-made `mozconfigs/windows-cross.mozconfig`
(clang-cl target, `WINSYSROOT`, and `--enable-bootstrap` so the build fetches
the Windows App SDK itself):

```sh
scripts/apply.sh
cd engine
export MOZCONFIG=$PWD/../mozconfigs/windows-cross.mozconfig
./mach build && ./mach package
# -> ../obj-skein-win/dist/skein-<version>.en-US.win64.installer.exe (+ .zip)
```

This works: a full cross build takes about 30 minutes on a laptop. The
resulting installer has not yet been run on a real Windows machine.

## Unsigned builds

Without a code-signing certificate, Windows SmartScreen shows "Windows
protected your PC / unknown publisher" for the installer. Users can choose
"More info", "Run anyway". Publish SHA-256 checksums with every release.
