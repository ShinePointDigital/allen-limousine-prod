---
name: Manual-capture booking lifecycle
description: Integrity rules for authorization holds, booking activation, and ride-completion capture.
---

Keep new bookings hidden and side-effect-free until Stripe confirms a manual-capture authorization. Activation must atomically claim promotions and create dispatch/admin effects. Every path that marks a ride complete must use the same idempotent capture transition.

**Why:** Persisting or notifying before authorization creates false reservations; separate completion paths can bypass capture; concurrent activation can cancel valid holds or duplicate messages unless transition ownership is explicit.

**How to apply:** Use a payment-pending state, return whether the current request performed activation, send confirmation only for that owner, validate ride updates before capture, and re-read state after ambiguous failures before compensating.