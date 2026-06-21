#!/usr/bin/env bash
# Usage: ./scripts/delete_profile.sh <profileId>
set -e

PID="$1"
[ -z "$PID" ] && echo "Usage: $0 <profileId>" && exit 1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rm -rf "$ROOT/profiles/$PID" "$ROOT/docs/$PID"

python3 - <<EOF
import json
from pathlib import Path
f = Path("$ROOT/docs/profiles.json")
d = json.loads(f.read_text())
d["profiles"] = [p for p in d["profiles"] if p["id"] != "$PID"]
d["default"] = d["profiles"][0]["id"] if d["profiles"] else None
f.write_text(json.dumps(d, ensure_ascii=False, indent=2))
print(f"[ok] Profil $PID supprimé")
EOF
