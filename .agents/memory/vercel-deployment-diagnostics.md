---
name: Vercel deployment diagnostics
description: How much Vercel deployment detail is available through the connected GitHub integration.
---

GitHub’s Vercel App status can confirm that an automatic deployment started and whether it succeeded, but it does not expose the private build-log cause. Detailed inspection or direct retries require an attached Vercel connection.

**Why:** The repository can have a healthy prior Vercel deployment while a new commit fails, and the GitHub status only points to the Vercel CLI or dashboard for the actual error.

**How to apply:** If a Vercel deployment fails and no Vercel connection is attached, report the failure and ask to connect Vercel before changing production configuration or guessing at the build cause.