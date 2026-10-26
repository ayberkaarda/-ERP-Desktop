#!/bin/sh
# Rewrites crates/keystone-sync/src/wire/from_schema from contracts/sync and
# fails if the committed files differ (schema edited without regenerating,
# or a hand edit of the output).
set -eu

desktop=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=crates/keystone-sync/src/wire/from_schema

cd "$desktop"
cargo run --quiet --locked -p keystone-wire-codegen -- --out "$out"
rustfmt --edition 2024 "$out"/error_code.rs "$out"/schema_digest.rs

if [ -n "$(git status --porcelain -- "$out")" ]; then
  printf '%s\n' "Wire code is out of date with contracts/sync. Commit the regenerated files and review the hand-written wire types:"
  git status --short -- "$out"
  git --no-pager diff --stat -- "$out"
  exit 1
fi
printf '%s\n' 'Wire code matches contracts/sync.'
