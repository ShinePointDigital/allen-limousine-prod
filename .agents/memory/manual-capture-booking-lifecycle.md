---
name: Manual-capture booking lifecycle
description: Integrity rules for authorization holds, booking activation, and ride-completion capture.
---

Keep new bookings hidden and side-effect-free until Stripe confirms a manual-capture authorization. Activation must atomically claim promotions and create dispatch/admin effects. Every completion path must use the same idempotent capture transition. Cancellation must validate without writing, release the hold idempotently, then persist the terminal ride state; canceled payments cannot be dispatched or reopened.

**Why:** Persisting or notifying before authorization creates false reservations; separate completion paths can bypass capture; releasing a hold before validating edits or allowing canceled rides to reactivate creates active work with no valid authorization.

**How to apply:** Use a payment-pending state, send confirmation only for the activation owner, create an unassigned dispatch ride for every authorized booking type, validate terminal transitions through read-only checks, make capture/release idempotent, and gate dispatch and reopening on payment state.