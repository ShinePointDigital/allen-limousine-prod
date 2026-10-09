import assert from "node:assert/strict";
import test from "node:test";
import { validPassengerCapacity } from "./chauffeur-pairing.js";

test("pairing accepts positive seats and ascending fleet ranges", () => {
  for (const value of ["3", "1-6", "1–6", "  1 – 6  ", "100"]) {
    assert.equal(validPassengerCapacity(value), true, value);
  }
});

test("pairing rejects malformed, descending, zero and excessive capacities", () => {
  for (const value of ["", "0", "0-6", "6-1", "101", "1-101", "-3", "3.5", "6 seats", "1e3", "Infinity", "1".repeat(31)]) {
    assert.equal(validPassengerCapacity(value), false, value);
  }
});
