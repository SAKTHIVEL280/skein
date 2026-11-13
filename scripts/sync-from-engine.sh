#!/usr/bin/env bash
# Development helper: after editing Skein's own files inside engine/, copy
# them back into the overlay tree so they are tracked in this repository.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${1:-$ROOT/engine}"
for dir in browser/components/skein browser/branding/skein; do
  rm -rf "$ROOT/skein/$dir"
  mkdir -p "$ROOT/skein/$dir"
  cp -a "$ENGINE/$dir/." "$ROOT/skein/$dir/"
done
echo "Overlay refreshed from $ENGINE."
