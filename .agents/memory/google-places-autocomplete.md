---
name: Google Places autocomplete
description: Compatibility rule for address suggestions when Google Maps itself still loads.
---

Use `AutocompleteSuggestion.fetchAutocompleteSuggestions` with `PlacePrediction.toPlace()` and `Place.fetchFields()` for address autocomplete. Keep a non-Google server fallback and switch to it after the first provider rejection.

**Why:** Google no longer makes the legacy `AutocompleteService` and `PlacesService` available to new customers. A key can render maps while autocomplete fails because Places API is not enabled, not included in the key's API restrictions, or the production HTTP referrer is not allowed.

**How to apply:** Treat map rendering and Places autocomplete as separate capabilities. Use the current Places API first, retain legacy support only as a compatibility branch, and fail over to server-side search rather than repeatedly retrying rejected browser requests.