#!/usr/bin/env bash
# Creates the notes and pictures indexes in the local Elasticsearch of deploy/dev/compose.yaml (profile "search"), with the same
# mappings as the live indexes. Safe to re-run: an index that exists is left alone. Dev only.
set -euo pipefail

ES="${ES_URL:-http://localhost:9200}"
dir="$(cd "$(dirname "$0")" && pwd)/es-mappings"

for file in "$dir"/*.json; do
  index="$(basename "$file" .json)"
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -I "$ES/$index")" = 200 ]; then
    echo "$index exists"
  else
    curl -sf -X PUT -H 'Content-Type: application/json' --data-binary "@$file" "$ES/$index" > /dev/null
    echo "created $index"
  fi
done
