---
name: Customer tracking access
description: Security and truthfulness rules for customer-facing live reservation tracking.
---

Customer tracking must use a separate high-entropy capability whose hash and expiration are stored server-side. Booking request IDs are idempotency keys, not permanent tracking credentials. Only show driver position, vehicle, contact details, and flight status when supplied by an authoritative source.

**Why:** Reservation IDs can leak through retries, metadata, or exports, and invented fallback data can misdirect customers or expose private trip details.

**How to apply:** Any new tracking endpoint, wallet export, notification link, or driver integration must preserve capability-based access and must distinguish a route preview from verified live telemetry.