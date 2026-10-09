#!/usr/bin/env bash
set -euo pipefail

npm ci --no-audit --no-fund
npm run db:deploy:development
npm run build
