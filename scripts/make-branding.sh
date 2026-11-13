#!/usr/bin/env bash
# Generate skein/browser/branding/skein from Firefox's trademark-free
# "unofficial" branding plus Skein's own name, icons and default prefs.
# Requires: rsvg-convert, ImageMagick (magick).
# Usage: scripts/make-branding.sh [path-to-engine]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${1:-$ROOT/engine}"
SRC="$ROOT/branding-src"
OUT="$ROOT/skein/browser/branding/skein"
BASE="$ENGINE/browser/branding/unofficial"

rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
git -C "$ENGINE" archive HEAD browser/branding/unofficial | tar -x -C "$ROOT/skein" --transform 's#^browser/branding/unofficial#browser/branding/skein#'

png() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }
LOGO="$SRC/skein-logo.svg"
PRIV="$SRC/skein-logo-private.svg"

for s in 16 22 24 32 48 64 128 256; do png "$LOGO" "$s" "$OUT/default$s.png"; done
png "$LOGO" 300 "$OUT/VisualElements_150.png"
png "$LOGO" 142 "$OUT/VisualElements_70.png"
png "$PRIV" 300 "$OUT/PrivateBrowsing_150.png"
png "$PRIV" 142 "$OUT/PrivateBrowsing_70.png"
png "$LOGO" 192 "$OUT/content/about-logo.png"
png "$LOGO" 384 "$OUT/content/about-logo@2x.png"
png "$PRIV" 192 "$OUT/content/about-logo-private.png"
png "$PRIV" 384 "$OUT/content/about-logo-private@2x.png"
cp "$LOGO" "$OUT/content/about-logo.svg"

A="$OUT/msix/Assets"
png "$LOGO" 620 "$A/LargeTile.scale-200.png"
png "$LOGO" 300 "$A/MedTile.scale-200.png"
png "$LOGO" 142 "$A/SmallTile.scale-200.png"
png "$LOGO" 300 "$A/Square150x150Logo.scale-200.png"
png "$LOGO" 256 "$A/Square44x44Logo.altform-lightunplated_targetsize-256.png"
png "$LOGO" 256 "$A/Square44x44Logo.altform-unplated_targetsize-256.png"
png "$LOGO" 88 "$A/Square44x44Logo.scale-200.png"
png "$LOGO" 256 "$A/Square44x44Logo.targetsize-256.png"
png "$LOGO" 100 "$A/StoreLogo.scale-200.png"
magick "$A/MedTile.scale-200.png" -background none -gravity center -extent 620x300 "$A/Wide310x150Logo.scale-200.png"
magick "$OUT/content/about-logo.png" -background none -gravity center -extent 300x236 "$OUT/content/about.png"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for s in 16 32 48 64 256; do png "$LOGO" "$s" "$TMP/l$s.png"; png "$PRIV" "$s" "$TMP/p$s.png"; done
magick "$TMP/l16.png" "$TMP/l32.png" "$TMP/l48.png" "$TMP/l256.png" "$OUT/firefox.ico"
magick "$TMP/l16.png" "$TMP/l32.png" "$TMP/l48.png" "$TMP/l64.png" "$OUT/firefox64.ico"
magick "$TMP/p16.png" "$TMP/p32.png" "$TMP/p48.png" "$TMP/p256.png" "$OUT/pbmode.ico"

wordmark() {
cat > "$1" <<SVG
<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 372 99">
  <text x="0" y="78" fill="context-fill" font-family="system-ui, sans-serif" font-size="92" font-weight="700" letter-spacing="-3">Skein</text>
</svg>
SVG
}
wordmark "$OUT/content/about-wordmark.svg"
wordmark "$OUT/content/firefox-wordmark.svg"

cat > "$OUT/configure.sh" <<'CFG'
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

MOZ_APP_DISPLAYNAME=Skein
MOZ_MACBUNDLE_ID=skein
CFG

cat > "$OUT/locales/en-US/brand.ftl" <<'FTL'
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Skein brand names. Skein is not affiliated with or endorsed by Mozilla.

-brand-shorter-name = Skein
-brand-short-name = Skein
-brand-shortcut-name = Skein
-brand-full-name = Skein
-brand-product-name = Skein
-vendor-short-name = Skein
trademarkInfo = Skein is an independent open-source browser built on Gecko. It is not affiliated with or endorsed by Mozilla.
FTL

cat > "$OUT/locales/en-US/brand.properties" <<'PROPS'
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

brandShorterName=Skein
brandShortName=Skein
brandFullName=Skein
PROPS

cp "$SRC/firefox-branding.js" "$OUT/pref/firefox-branding.js"
REPO="https://github.com/SAKTHIVEL280/skein"
sed -i -E \
  -e 's/Mozilla Developer Preview/Skein/g' \
  -e 's/"mozilla\.org"/"Skein"/' \
  -e "s#\"https://(www|support)\.mozilla\.org\"#\"$REPO\"#" \
  -e "s#\"https://download\.mozilla\.org/[^\"]*\"#\"$REPO/releases\"#" \
  -e 's/Nightly/Skein/g' \
  "$OUT/branding.nsi"
echo "Branding written to $OUT"
