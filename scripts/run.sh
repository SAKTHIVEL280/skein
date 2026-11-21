#!/usr/bin/env bash
# Launch the current development build of Skein (obj-skein/dist/bin/skein).
# This always runs the code you just built. The copies under obj-*/dist/skein
# and dist/ are packaged snapshots and go stale the moment you rebuild.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/obj-skein/dist/bin/skein" "$@"
