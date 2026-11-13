#!/usr/bin/env bash
# Put Skein onto a Firefox ESR checkout:
#   1. copy the overlay tree (skein/ -> engine/), which only adds new files;
#   2. apply patches/*.patch, the (few) edits to upstream files. See PATCHES.md.
# Safe to re-run: already-applied patches are skipped.
# Usage: scripts/apply.sh [path-to-engine]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${1:-$ROOT/engine}"

cp -a "$ROOT/skein/browser/." "$ENGINE/browser/"
cp "$ROOT/mozconfigs/$(uname -s | tr 'A-Z' 'a-z' | sed 's/mingw.*/windows/;s/msys.*/windows/').mozconfig" "$ENGINE/mozconfig"

shopt -s nullglob
for patch in "$ROOT"/patches/*.patch; do
  name="$(basename "$patch")"
  if git -C "$ENGINE" apply --reverse --check "$patch" 2>/dev/null; then
    echo "already applied: $name"
  elif git -C "$ENGINE" apply --check "$patch" 2>/dev/null; then
    git -C "$ENGINE" apply "$patch"
    echo "applied: $name"
  else
    echo "FAILED: $name does not apply to $ENGINE (upstream changed?)" >&2
    exit 1
  fi
done
# Error pages carry hard-coded product names in this one locale file; every
# other string goes through the brand terms in browser/branding/skein.
sed -i 's/Firefox/Skein/g' "$ENGINE/browser/locales/en-US/chrome/overrides/appstrings.properties"
# The address bar's local results group is labelled with a Mozilla product name.
sed -i 's/^-firefox-suggest-brand-name = .*/-firefox-suggest-brand-name = Suggestions/' "$ENGINE/toolkit/locales/en-US/toolkit/branding/brandings.ftl"

echo "Skein overlay and patches are in place."
