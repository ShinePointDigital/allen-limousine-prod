#!/usr/bin/env bash
set -euo pipefail

npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
npm run build