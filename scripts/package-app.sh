#!/usr/bin/env bash
# Build dist/metrics_explorer-<version>.tar.gz from app/ plus the webpack bundle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
STAGE="${ROOT}/stage/metrics_explorer"
DIST="${ROOT}/dist"
BUNDLE="${ROOT}/build/appserver/static/build/explorer.js"

if [[ ! -f "$BUNDLE" ]]; then
  echo "Missing ${BUNDLE}. Run npm run build first." >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE" "$DIST"
cp -R "${ROOT}/app/." "$STAGE/"
mkdir -p "${STAGE}/appserver/static"
cp -R "${ROOT}/build/appserver/static/build" "${STAGE}/appserver/static/build"
find "$STAGE" -name '.DS_Store' -delete
find "$STAGE" -name '._*' -delete

COPYFILE_DISABLE=1 tar -czf "${DIST}/metrics_explorer-${VERSION}.tar.gz" \
  --exclude='.*' \
  -C "${ROOT}/stage" metrics_explorer

echo "Wrote ${DIST}/metrics_explorer-${VERSION}.tar.gz"
