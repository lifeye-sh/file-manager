#!/usr/bin/env bash
set -euo pipefail

# The release ZIP contains platform-neutral sources and the dependency lock.
# Install production dependencies with npm ci on the deployment platform.
test "$(git rev-parse HEAD)" = "${NT_COMMIT_SHA:?missing selected commit}"
test ! -e dist
npm ci --ignore-scripts --registry=https://registry.npmjs.org --replace-registry-host=always --no-audit --no-fund
npm test

mkdir dist
git archive --format=tar "$NT_COMMIT_SHA" -- server.js add-user.js package.json package-lock.json \
  config integrations middleware public routes services utils | tar -x -C dist
test -s dist/server.js
test -s dist/public/index.html
