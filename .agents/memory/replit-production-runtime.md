---
name: Replit production runtime
description: Production-mode and environment-refresh requirements for this app's Replit deployment.
---

Set `NODE_ENV=production` specifically in the published environment, and republish whenever production secrets or environment variables change.

**Why:** Replit publishing did not automatically set production mode for this app, so the deployed process started Vite middleware. Existing deployments also retained the environment snapshot from their publish time.

**How to apply:** Keep development mode unchanged for the workspace workflow. For production failures, verify secret existence without reading values, then republish before diagnosing the refreshed deployment.