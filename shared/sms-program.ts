export const SMS_BRAND = "Allen Express, LLC (dba Allan Limousine)";
export const SMS_OPT_IN_CONFIRMATION = `${SMS_BRAND}: You are opted in to reservation, pickup and ride-status texts. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out or HELP for help.`;
export const SMS_OPT_OUT_CONFIRMATION = `${SMS_BRAND}: You are unsubscribed from service-related texts. No more messages will be sent. Reply START to opt in again. Opting out does not cancel your reservation.`;
export function smsHelpResponse(contactPhone: string) {
  return `${SMS_BRAND}: For reservation or SMS help, call ${contactPhone}. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out.`;
}
export function inboundSmsResponse(body: string, contactPhone: string, providerHandled?: string) {
  // Advanced Opt-Out responds itself; never send a second keyword response.
  if (providerHandled) return null;
  const keyword = body.trim().toUpperCase();
  if (["HELP", "INFO"].includes(keyword)) return smsHelpResponse(contactPhone);
  // Standard long-code START/STOP replies are also sent by Twilio itself.
  // Their branded templates belong in Messaging Service Opt-Out Management.
  return null;
}
