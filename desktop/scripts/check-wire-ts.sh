#!/bin/sh
# Regenerates src/wire/generated from contracts/ (scripts/gen-wire-ts.mjs:
# json-schema-to-typescript types, the fixture set, the online-only table)
# and fails if the committed files differ: a contract changed without
# regenerating, or a hand edit of the output.
set -eu

desktop=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=src/wire/generated

cd "$desktop"
node scripts/gen-wire-ts.mjs

# Changed or deleted files (against the index) and files that are not tracked yet.
if ! git --no-pager diff --exit-code --stat -- "$out" || [ -n "$(git ls-files --others --exclude-standard -- "$out")" ]; then
  printf '%s\n' "Wire TypeScript is out of date with contracts/. Run npm run -w desktop wire:gen and commit src/wire/generated:"
  git ls-files --others --exclude-standard -- "$out"
  exit 1
fi
printf '%s\n' 'Wire TypeScript matches contracts/.'
