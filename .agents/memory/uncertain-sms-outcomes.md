---
name: Uncertain SMS outcomes
description: Safety rule for ambiguous provider responses and manual dispatch reconciliation.
---

An SMS transport error is not proof that the provider rejected the message. Keep the dispatch attempt pending until a provider lookup confirms acceptance or failure, and bind reconciliation only to a provider record matching the original destination and body.

**Why:** A timeout can happen after a provider accepts a message; treating it as failed permits a retry that sends duplicate driver instructions.

**How to apply:** Any future dispatch changes must preserve the pending lock on ambiguous outcomes and verify provider identity before clearing it.