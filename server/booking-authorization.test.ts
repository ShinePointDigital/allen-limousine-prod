import assert from "node:assert/strict";
import test from "node:test";
import { authorizeBooking, AuthorizationRejectedError, type AuthorizationBooking, type AuthorizationStripe } from "./booking-authorization.js";

function fixture(status = "requires_capture", failure = false) {
  const calls: { amounts: number[]; keys: string[]; saves: number; syncs: number; activations: number; methods: number } = { amounts: [], keys: [], saves: 0, syncs: 0, activations: 0, methods: 0 };
  const booking: AuthorizationBooking = { id: "booking", bookingRequestId: "request", estimatedFareCents: 8500, gratuityCents: 1275, authorizedTotalCents: 9775 };
  const intent = {id:"pi_example",status,amount:9775,currency:"usd"};
  const stripe: AuthorizationStripe = {
    paymentMethods:{retrieve:async()=>{calls.methods++;return {customer:"cus_example"};}},
    paymentIntents:{
      retrieve:async()=>intent,
      create:async(data,options)=>{calls.amounts.push(data.amount);calls.keys.push(options.idempotencyKey);if(failure)throw new Error("Card declined");return intent;},
    },
  };
  const effects = {
    savePayment:async()=>{calls.saves++;},
    syncStatus:async()=>{calls.syncs++;},
    activate:async()=>{calls.activations++;},
  };
  return {calls,booking,intent,stripe,effects};
}
const card = { customerId:"cus_example",paymentMethodId:"pm_example",expectedAuthorizedTotalCents:9775 };
test("authorization includes discounted fare and gratuity separately and activates only after a hold",async()=>{
  const f=fixture();await authorizeBooking(f.booking,card,f.stripe,f.effects);
  assert.deepEqual(f.calls.amounts,[9775]);assert.equal(f.calls.activations,1);assert.equal(f.calls.saves,1);
});
test("no-tip and old bookings authorize only the fare",async()=>{
  const f=fixture();f.booking={id:"legacy",bookingRequestId:"legacy-request",estimatedFareCents:8500};f.intent.amount=8500;
  await authorizeBooking(f.booking,{...card,expectedAuthorizedTotalCents:8500},f.stripe,f.effects);
  assert.deepEqual(f.calls.amounts,[8500]);
});
test("retry reuses an existing authorization without creating or changing its amount",async()=>{
  const f=fixture();f.booking.stripePaymentIntentId=f.intent.id;
  await authorizeBooking(f.booking,card,f.stripe,f.effects);
  assert.equal(f.calls.amounts.length,0);assert.equal(f.calls.methods,0);assert.equal(f.calls.activations,1);
});
test("a cancelled booking or released hold cannot create a replacement authorization",async()=>{
  const f=fixture();f.booking.status="CANCELLED";
  await assert.rejects(authorizeBooking(f.booking,card,f.stripe,f.effects),/cancelled/);
  assert.equal(f.calls.amounts.length,0);assert.equal(f.calls.activations,0);
  const g=fixture("canceled");g.booking.stripePaymentIntentId=g.intent.id;
  const result=await authorizeBooking(g.booking,card,g.stripe,g.effects);
  assert.equal(result.status,"canceled");assert.equal(g.calls.amounts.length,0);assert.equal(g.calls.activations,0);
});
test("network retries use the same Stripe idempotency key",async()=>{
  const f=fixture();await authorizeBooking(f.booking,card,f.stripe,f.effects);await authorizeBooking(f.booking,card,f.stripe,f.effects);
  assert.deepEqual(f.calls.keys,["booking-auth-request-initial","booking-auth-request-initial"]);
});
test("decline and non-authorized statuses never activate a booking",async()=>{
  const f=fixture("requires_capture",true);await assert.rejects(authorizeBooking(f.booking,card,f.stripe,f.effects),/declined/);assert.equal(f.calls.activations,0);assert.equal(f.calls.saves,0);
  const g=fixture("requires_action");await assert.rejects(authorizeBooking(g.booking,card,g.stripe,g.effects),/not completed/);assert.equal(g.calls.activations,0);
});
test("definitive Stripe card declines allow recovery; network and ambiguous outcomes remain unknown",async()=>{
  for (const failure of [
    Object.assign(new Error("Card declined"),{type:"StripeCardError",code:"card_declined"}),
    Object.assign(new Error("Card expired"),{type:"StripeCardError",code:"expired_card"}),
    Object.assign(new Error("Authentication failed"),{type:"StripeCardError",payment_intent:{status:"requires_payment_method"}}),
  ]) {
    const f=fixture();f.stripe.paymentIntents.create=async()=>{throw failure;};
    await assert.rejects(authorizeBooking(f.booking,card,f.stripe,f.effects),error=>error instanceof AuthorizationRejectedError);
    assert.equal(f.calls.activations,0);
  }
  for (const failure of [
    Object.assign(new Error("Network timeout"),{type:"StripeConnectionError",code:"card_declined"}),
    Object.assign(new Error("Unknown card outcome"),{type:"StripeCardError",code:"processing_error"}),
    Object.assign(new Error("Pending outcome"),{type:"StripeCardError",code:"card_declined",payment_intent:{status:"requires_capture"}}),
  ]) {
    const f=fixture();f.stripe.paymentIntents.create=async()=>{throw failure;};
    await assert.rejects(authorizeBooking(f.booking,card,f.stripe,f.effects),error=>error===failure && !(error instanceof AuthorizationRejectedError));
    assert.equal(f.calls.activations,0);
  }
  const rejected=fixture("requires_payment_method");
  await assert.rejects(authorizeBooking(rejected.booking,card,rejected.stripe,rejected.effects),AuthorizationRejectedError);
  assert.equal(rejected.calls.activations,0);
});
test("tampered total, Stripe mismatch or wrong card owner blocks activation",async()=>{
  const f=fixture();await assert.rejects(authorizeBooking(f.booking,{...card,expectedAuthorizedTotalCents:8500},f.stripe,f.effects),/total changed/);assert.equal(f.calls.amounts.length,0);
  const g=fixture();g.booking.stripePaymentIntentId=g.intent.id;g.intent.amount=8500;
  await assert.rejects(authorizeBooking(g.booking,card,g.stripe,g.effects),/does not match/);assert.equal(g.calls.activations,0);assert.equal(g.calls.syncs,0);
  const h=fixture();await assert.rejects(authorizeBooking(h.booking,{...card,customerId:"cus_other"},h.stripe,h.effects),/does not belong/);assert.equal(h.calls.activations,0);
});
