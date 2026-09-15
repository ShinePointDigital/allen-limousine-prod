---
name: Hero vehicle overlays
description: Preserving the seamless hero loop when compositing branding onto the Cadillac.
---

Any graphic placed on the Cadillac must track the physical plate recess rather than remain fixed in the page, and it must mirror the overlapping vehicle images during the loop’s final crossfade.

**Why:** A single static overlay visibly drifts as the Cadillac moves, and an opaque overlay during the final transition breaks the otherwise seamless loop.

**How to apply:** Inspect start, midpoint, and end frames at full resolution; interpolate position and scale across the clip; fade the outgoing overlay while fading a second copy into the reset position during the loop transition. Preserve the source duration, frame rate, dimensions, and video element behavior.