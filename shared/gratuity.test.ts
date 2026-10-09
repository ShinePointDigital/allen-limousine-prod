import assert from "node:assert/strict";
import test from "node:test";
import { bookingAmounts, customGratuityCents, gratuitySelectionSchema, storedAuthorizationAmount } from "./gratuity.js";

test("no gratuity is the default; cents are never rounded to whole dollars", () => {
  assert.deepEqual(bookingAmounts(12345, 0), { fareCents: 12345, gratuityCents: 0, authorizedTotalCents: 12345 });
  assert.equal(storedAuthorizationAmount({ estimatedFareCents: 12345 }), 12345);
});
test("percentage gratuity uses the discounted fare and rounds once to cents", () => {
  assert.deepEqual(bookingAmounts(12345, 1500, { kind: "percentage", percent: 15 }), { fareCents: 10845, gratuityCents: 1627, authorizedTotalCents: 12472 });
  assert.equal(bookingAmounts(10005, 0, { kind: "percentage", percent: 10 }).gratuityCents, 1001);
});
test("custom amounts use exact decimal-to-cent arithmetic and discounts do not reduce tips", () => {
  assert.equal(customGratuityCents("10.01"), 1001);
  assert.equal(customGratuityCents("0.29"), 29);
  assert.deepEqual(bookingAmounts(10000, 1500, { kind: "custom", amountCents: 1234 }), { fareCents: 8500, gratuityCents: 1234, authorizedTotalCents: 9734 });
  assert.equal(bookingAmounts(100, 100, { kind: "none" }).authorizedTotalCents, 0);
});
test("invalid, tampered or excessive selections are rejected", () => {
  for (const selection of [
    {kind:"none",amountCents:500}, {kind:"percentage",percent:25},
    {kind:"percentage",percent:"15"}, {kind:"custom",amountCents:-1},
    {kind:"custom",amountCents:0.5}, {kind:"custom",amountCents:100001},
    {kind:"custom",amountCents:"500"}, {kind:"unknown"}, null,
  ]) assert.equal(gratuitySelectionSchema.safeParse(selection).success, false);
  for (const dollars of ["-1", "1.001", "Infinity", "1e2", " 2", "", ".5", "1000.01"]) assert.throws(() => customGratuityCents(dollars));
  assert.throws(() => bookingAmounts(1_000_000,0,{kind:"percentage",percent:20}), /exceed/);
});
test("tampered expected totals and inconsistent stored totals fail explicitly", () => {
  assert.throws(() => bookingAmounts(10000,1500,{kind:"custom",amountCents:500},10000), /Review/);
  assert.throws(() => storedAuthorizationAmount({estimatedFareCents:10000,gratuityCents:500,authorizedTotalCents:10000}), /does not match/);
  assert.throws(() => bookingAmounts(100,101), /Discount/);
  assert.throws(() => storedAuthorizationAmount({estimatedFareCents:100,gratuityCents:-1}), /Invalid/);
});
