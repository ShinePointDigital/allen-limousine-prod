import { storedAuthorizationAmount } from "../shared/gratuity.js";

type Booking = Parameters<typeof storedAuthorizationAmount>[0] & { stripePaymentIntentId?: string | null };
type Intent = { id:string; amount:number; currency:string; status:string; amount_received?:number };
type CaptureDependencies = {
  findBooking(id:string):Promise<Booking|null>;
  stripe():Promise<{paymentIntents:{
    retrieve(id:string):Promise<Intent>;
    capture(id:string, data:Record<string,never>, options:{idempotencyKey:string}):Promise<Intent>;
  }}>;
  sync(id:string,status:string):Promise<unknown>;
};
/** Driver completion, dispatcher capture and manual payment actions share this operation. */
export async function captureBookingPayment(bookingRequestId:string, deps:CaptureDependencies) {
  const booking=await deps.findBooking(bookingRequestId);
  if(!booking?.stripePaymentIntentId)throw new Error("No card authorization exists for this booking.");
  const stripe=await deps.stripe();
  const current=await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
  const amount=storedAuthorizationAmount(booking);
  if(current.amount!==amount || current.currency!=="usd")throw new Error("The payment amount does not match the approved fare and gratuity.");
  if(current.status==="succeeded"){await deps.sync(current.id,current.status);return current;}
  if(current.status!=="requires_capture")throw new Error(`Payment cannot be captured while its status is ${current.status}.`);
  const captured=await stripe.paymentIntents.capture(current.id,{}, {idempotencyKey:`capture-${current.id}`});
  if(captured.amount!==amount || captured.currency!=="usd")throw new Error("The captured payment does not match the approved fare and gratuity.");
  await deps.sync(captured.id,captured.status);
  if(captured.status!=="succeeded")throw new Error("Payment capture is not yet confirmed. Retry this same booking.");
  return captured;
}
