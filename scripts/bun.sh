#!/bin/sh
# Use a real bun when the machine has one (CI, local installs), else the pinned
# npx copy. The extension's bundler and checker are bun scripts.
set -eu

if command -v bun >/dev/null 2>&1; then
  exec bun "$@"
fi

exec npx -y bun@latest "$@"
