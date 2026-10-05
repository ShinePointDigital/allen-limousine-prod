---
name: PWA device policy
description: User-directed device scope for the website and phone PWA experience.
---

The user instructed: “for ipads, tablets and desktops do not route to the pwa. route directly to the website.”

**Why:** The user asked for the full website to be the direct entry experience on those devices.

**How to apply:** Preserve this policy when changing install prompts, PWA launch links, or booking transitions. Treat iPadOS browsers that identify as desktop Macs as tablets, not phones.

Changing website routing does not change the operating system's launch mode for an already-installed home-screen shortcut.

**Why:** The user reported that an iPad/tablet saved shortcut still opened as a PWA after the page routing was corrected; saved shortcuts can retain their standalone installation state.

**How to apply:** Check install metadata as well as page routing. Explain that existing standalone shortcuts may need to be removed and recreated, and do not claim JavaScript can force an installed standalone window into Safari or another browser.

Safari 26 on iOS/iPadOS defaults every Home Screen addition to a web app, regardless of site metadata. The user must turn off **Open as Web App** to create a browser-opening shortcut.

**Why:** This is an explicit operating-system choice, documented by WebKit: https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/

**How to apply:** Distinguish Safari bookmarks from Home Screen icons. Keep tablet install metadata disabled for older systems, but never promise that metadata alone controls Safari 26's launch mode.