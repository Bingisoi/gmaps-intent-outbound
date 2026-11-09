#!/usr/bin/env bash
# Symlink every skill into ~/.claude/skills and create .env. Never overwrites an existing skill.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${HOME}/.claude/skills"
mkdir -p "$DEST"
command -v node >/dev/null || { echo "Node 22.6+ is required"; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<6)){console.error("Node 22.6+ required, found "+process.versions.node);process.exit(1)}'
for s in "$ROOT"/skills/*/; do
  name="$(basename "$s")"
  if [ -L "$DEST/$name" ] && [ "${1:-}" = "--relink" ]; then rm "$DEST/$name"; fi
  if [ -e "$DEST/$name" ]; then echo "skip   $name (already exists; use --relink to refresh symlinks)"; continue; fi
  ln -s "${s%/}" "$DEST/$name" && echo "linked $name"
done
[ -f "$ROOT/.env" ] || { cp "$ROOT/.env.example" "$ROOT/.env"; echo "created .env: add your keys"; }
echo "Done. Start a NEW Claude Code session, then run /gmaps-outbound-autopilot"
