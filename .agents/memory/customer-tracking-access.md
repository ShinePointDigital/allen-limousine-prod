---
name: Customer tracking access
description: Security and truthfulness rules for customer-facing live reservation tracking.
---

Customer tracking must use a separate high-entropy capability whose hash and expiration are stored server-side. Booking request IDs are idempotency keys, not permanent tracking credentials. Only show driver position, vehicle, contact details, and flight status when supplied by an authoritative source.

**Why:** Reservation IDs can leak through retries, metadata, or exports, and invented fallback data can misdirect customers or expose private trip details.

**How to apply:** Any new tracking endpoint, wallet export, notification link, or driver integration must preserve capability-based access and must distinguish a route preview from verified live telemetry.

Customer notification links must load the reservation from the capability URL itself rather than relying on localStorage, and opening one in the installed PWA must bypass rider onboarding so tracking opens directly.

**Why:** SMS links may be opened on a new device or in a fresh PWA install; device-local reservation state is not a reliable access path.

**How to apply:** Keep notification URLs same-origin and inside the PWA scope, fetch the reservation by token, and prioritize the token flow before profile setup screens.