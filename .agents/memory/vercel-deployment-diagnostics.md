---
name: Vercel deployment diagnostics
description: The user's live admin target and the limits of GitHub-only Vercel diagnostics.
---

GitHub’s Vercel App status can confirm that an automatic deployment started and whether it succeeded, but it does not expose the private build-log cause. Detailed inspection or direct retries require an attached Vercel connection.

**Why:** The repository can have a healthy prior Vercel deployment while a new commit fails, and the GitHub status only points to the Vercel CLI or dashboard for the actual error.

**How to apply:** If a Vercel deployment fails and no Vercel connection is attached, report the failure and ask to connect Vercel before changing production configuration or guessing at the build cause.

The user confirmed that their live administrator website is the Vercel deployment, not the Replit published website.

**Why:** The user clarified the production target while requesting a new super-admin and password recovery.

**How to apply:** Check the Vercel deployment for live administrator issues. Do not imply that updating the Replit preview or using Replit's Publish action also updates Vercel.