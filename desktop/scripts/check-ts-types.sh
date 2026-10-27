#!/bin/sh
# Regenerates src/bridge/generated from the Rust DTOs (ts-rs export tests of
# keystone-desktop) and fails if the committed files differ: a DTO changed
# without regenerating, or a hand edit of the output.
set -eu

desktop=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=src/bridge/generated

cd "$desktop"
# Drop stale files first so a removed or renamed DTO shows up in the diff.
rm -f "$out"/*.ts
cargo test --quiet --locked -p keystone-desktop --lib export_bindings

# Changed or deleted files (against the index) and files that are not tracked yet.
if ! git --no-pager diff --exit-code --stat -- "$out" || [ -n "$(git ls-files --others --exclude-standard -- "$out")" ]; then
  printf '%s\n' "TypeScript types are out of date with the Rust DTOs. Run this script and commit src/bridge/generated:"
  git ls-files --others --exclude-standard -- "$out"
  exit 1
fi
printf '%s\n' 'TypeScript types match the Rust DTOs.'
