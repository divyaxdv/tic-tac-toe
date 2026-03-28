#!/bin/sh
set -e
#
# Custom entrypoint (Dockerfile ENTRYPOINT; docker-compose uses the same script — no override).
# Order is mandatory: 1) nakama migrate up   2) nakama server (exec replaces shell).
# The "&&" guarantees the server never starts if migration fails (set -e also exits on errors).
#
# Env: NAKAMA_DATABASE_ADDRESS or DATABASE_URL (e.g. Render).

CONFIG="${NAKAMA_CONFIG:-/nakama/data/local.yml}"

# Strip postgres:// scheme; ensure host:5432/db if port omitted; keep ?sslmode=...
normalize_database_url() {
  _raw="$1"
  _raw=$(printf '%s\n' "$_raw" | sed -e 's|^postgresql://||' -e 's|^postgres://||')
  _query=""
  case "$_raw" in
    *\?*)
      _query="?${_raw#*\?}"
      _raw="${_raw%%\?*}"
      ;;
  esac
  _cred="${_raw%@*}"
  _rest="${_raw#*@}"
  _host="${_rest%%/*}"
  _path="${_rest#*/}"
  case "$_host" in
    *:*);; # already has :port (or IPv6)
    *) _host="${_host}:5432" ;;
  esac
  printf '%s' "${_cred}@${_host}/${_path}${_query}"
}

if [ -z "$NAKAMA_DATABASE_ADDRESS" ] && [ -n "$DATABASE_URL" ]; then
  NAKAMA_DATABASE_ADDRESS="$(normalize_database_url "$DATABASE_URL")"
  export NAKAMA_DATABASE_ADDRESS
fi

if [ -z "$NAKAMA_DATABASE_ADDRESS" ]; then
  echo "Set NAKAMA_DATABASE_ADDRESS or DATABASE_URL (postgres user:pass@host:5432/db)."
  exit 1
fi

echo "[entrypoint] Step 1/2: nakama migrate up --database.address ..."
/nakama/nakama migrate up --database.address "$NAKAMA_DATABASE_ADDRESS"

echo "[entrypoint] Step 2/2: starting nakama server..."
exec /nakama/nakama --config "$CONFIG" --database.address "$NAKAMA_DATABASE_ADDRESS"
