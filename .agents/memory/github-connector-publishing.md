---
name: GitHub connector publishing
description: Safe fallback for publishing workspace changes when the HTTPS Git remote cannot authenticate.
---

When direct Git authentication is unavailable, use the connected GitHub API to create blobs, a tree based on the current remote tree, a commit, and a non-forced branch update. Do not include deletion entries for paths absent from the remote tree.

**Why:** Replit's authenticated GitHub connection can remain healthy even when the workspace's HTTPS Git credential is unavailable. GitHub rejects tree deletions for nonexistent paths with an opaque `GitRPC::BadObjectState` response.

**How to apply:** Verify the local build first, publish the intended changed files through the connector, fetch the resulting remote commit, and realign the local branch only after the local and remote tree hashes are identical.