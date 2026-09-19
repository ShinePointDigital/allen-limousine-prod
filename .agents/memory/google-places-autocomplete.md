---
name: Google Places autocomplete
description: Compatibility rule for address suggestions when Google Maps itself still loads.
---

Use `AutocompleteSuggestion.fetchAutocompleteSuggestions` with `PlacePrediction.toPlace()` and `Place.fetchFields()` for address autocomplete. Keep a non-Google server fallback for unavailable clients.

**Why:** Google no longer makes the legacy `AutocompleteService` and `PlacesService` available to new customers. A valid Maps key can still render maps while legacy address suggestions silently fail.

**How to apply:** For booking-location work, treat map rendering and Places autocomplete as separate capabilities. Use the current Places API first and retain legacy support only as a compatibility branch.