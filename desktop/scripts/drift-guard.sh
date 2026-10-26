#!/bin/sh
set -eu

remote=${1:-upstream}

git fetch "$remote" main
upstream_ref=FETCH_HEAD
base=$(git merge-base HEAD "$upstream_ref")

if git diff --quiet "$base" HEAD -- backend frontend contracts; then
  printf '%s\n' 'Drift guard passed: backend/, frontend/, and contracts/ match the merge-base.'
  exit 0
fi

printf '%s\n' 'Drift detected in these files:'
git diff --name-status "$base" HEAD -- backend frontend contracts
exit 1
