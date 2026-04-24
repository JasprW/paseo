#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_NEXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$(cd "$DESKTOP_NEXT_DIR/../app" && pwd)"
ROOT_DIR="$(cd "$DESKTOP_NEXT_DIR/../.." && pwd)"

EXPO_PORT=$("$ROOT_DIR/node_modules/.bin/get-port" 8081 8082 8083 8084 8085)
export EXPO_PORT

export PASEO_REPO_ROOT="${PASEO_REPO_ROOT:-$ROOT_DIR}"
export PASEO_CORS_ORIGINS="*"

case "${PASEO_NEXT_DAEMON_MODE:-isolated}" in
  stable|production|external|connect-only|connect_only)
    export PASEO_NEXT_DAEMON_MODE="stable"
    export PASEO_HOME="${PASEO_HOME:-$HOME/.paseo}"
    ;;
  *)
    export PASEO_HOME="${PASEO_HOME:-$HOME/.paseo-next}"
    export PASEO_NEXT_LISTEN="${PASEO_NEXT_LISTEN:-127.0.0.1:0}"
    export PASEO_DESKTOP_MANAGED=1
    ;;
esac

TAURI_CONFIG="{\"build\":{\"devUrl\":\"http://localhost:${EXPO_PORT}\"}}"

echo "══════════════════════════════════════════════════════"
echo "  Paseo Next Dev"
echo "══════════════════════════════════════════════════════"
echo "  Mode:      ${PASEO_NEXT_DAEMON_MODE:-isolated}"
echo "  Home:      ${PASEO_HOME}"
echo "  Listen:    ${PASEO_NEXT_LISTEN:-stable daemon}"
echo "  Metro:     http://localhost:${EXPO_PORT}"
echo "══════════════════════════════════════════════════════"

exec "$ROOT_DIR/node_modules/.bin/concurrently" \
  --kill-others \
  --names "metro,tauri" \
  --prefix-colors "magenta,cyan" \
  "cd '$APP_DIR' && BROWSER=none APP_VARIANT=development npx expo start --port $EXPO_PORT" \
  "$ROOT_DIR/node_modules/.bin/wait-on tcp:$EXPO_PORT && npm run tauri --workspace=@getpaseo/desktop-next -- dev --config '$TAURI_CONFIG'"
