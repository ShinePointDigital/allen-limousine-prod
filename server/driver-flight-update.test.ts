import assert from "node:assert/strict";
import test from "node:test";
import { mapFlight } from "./utils/flightTracker.js";
import { driverFlightUpdate } from "./driver-flight-update.js";

const now = Date.parse("2026-10-15T15:00:00Z");
function fixture() {
  const flight = mapFlight({
    flight_date:"2026-10-15", flight_status:"active",
    departure:{ iata:"JFK", timezone:"America/New_York", scheduled:"2026-10-15T12:00:00Z", terminal:"8", gate:"B12" },
    arrival:{ iata:"DFW", timezone:"America/Chicago", scheduled:"2026-10-15T16:00:00Z", estimated:"2026-10-15T16:20:00Z", terminal:"D", gate:"D22", baggage:"7" },
  }, "AA123", new Date(now).toISOString());
  flight.verifiedBookingContext = {
    flightNumber:"AA123", scheduledAt:"2026-10-15T16:00:00.000Z", airportCode:"DFW",
    flightDate:flight.flightDate, departureAirportCode:flight.departureAirportCode, arrivalAirportCode:flight.arrivalAirportCode,
    scheduledDepartureTime:flight.scheduledDepartureTime, scheduledArrivalTime:flight.scheduledArrivalTime,
  };
  return {flightNumber:"AA 123", flightScheduledAt:new Date("2026-10-15T16:00:00Z"),airportCode:"DFW",isPrivateFBO:false,flightDetails:flight};
}
test("fresh matched arrival projects explicit operational fields, not raw provider payloads", () => {
  const booking = fixture();
  const update = driverFlightUpdate(booking, now);
  assert.equal(update.state,"current");
  assert.equal(update.airportRole,"arrival");
  assert.equal(update.terminal,"D");
  assert.equal(update.gate,"D22");
  assert.equal(update.estimatedTime,"2026-10-15T16:20:00.000Z");
  assert.equal(update.actualTime,null);
  assert.equal(update.baggageBelt,"7");
  assert.equal(update.validUntil,"2026-10-15T15:05:00.000Z");
  assert.equal("verifiedBookingContext" in update,false);
});
test("stale and missing metadata never fall back to booked or legacy hints", () => {
  const booking=fixture();
  for (const age of [300_000,301_000,86400_000]) {
    const update=driverFlightUpdate(booking,now+age);
    assert.equal(update.state,"stale");
    assert.equal(update.fetchedAt,booking.flightDetails.fetchedAt);
    assert.equal(update.terminal,null);
    assert.equal(update.gate,null);
    assert.equal(update.status,null);
    assert.equal(update.estimatedTime,null);
  }
  for (const details of [null,{},[],{...booking.flightDetails,verifiedBookingContext:undefined}]) {
    assert.equal(driverFlightUpdate({...booking,flightDetails:details},now).state,"unavailable");
  }
  booking.flightDetails.arrivalTerminal=null;
  booking.flightDetails.arrivalGate=null;
  booking.flightDetails.baggageBelt=null;
  assert.equal(driverFlightUpdate(booking,now).terminal,null);
  assert.equal(driverFlightUpdate(booking,now).gate,null);
  assert.equal(driverFlightUpdate(booking,now).baggageBelt,null);
});
test("rejects wrong occurrence, route, airport, date, malformed data and future fetch times", () => {
  const booking=fixture();
  for(const patch of [
    {flightNumber:"AA999"}, {flightDate:"2026-10-16"}, {arrivalAirportCode:"ORD"}, {departureAirportCode:"LAX"},
    {scheduledArrivalTime:"2026-10-16T16:00:00Z"}, {source:"Unknown"}, {fetchedAt:"invalid"},
    {fetchedAt:new Date(now+1).toISOString()}, {arrivalTimezone:"invalid"}, {departureTimezone:null},
  ]) assert.equal(driverFlightUpdate({...booking,flightDetails:{...booking.flightDetails,...patch}},now).state,"unavailable",JSON.stringify(patch));
  for (const patch of [{flightScheduledAt:new Date("2026-10-16T16:00:00Z")},{airportCode:"ORD"},{flightNumber:"UA123"},{isPrivateFBO:true}]) {
    assert.equal(driverFlightUpdate({...booking,...patch},now).state,"unavailable");
  }
  // Even a self-consistent record from an adjacent local day must not pass the 12-hour rank window.
  const flight=structuredClone(booking.flightDetails);
  flight.scheduledArrivalTime="2026-10-15T04:30:00.000Z";
  flight.verifiedBookingContext!.scheduledArrivalTime=flight.scheduledArrivalTime;
  assert.equal(driverFlightUpdate({...booking,flightDetails:flight},now).state,"unavailable");
  flight.scheduledArrivalTime="2026-10-15T18:00:00.000Z";
  flight.verifiedBookingContext!.scheduledArrivalTime=flight.scheduledArrivalTime;
  assert.equal(driverFlightUpdate({...booking,flightDetails:flight},now).state,"unavailable","Never substitute a same-day occurrence near the booked time");
});
test("departure trips show departure updates only; local departure date handles overnight arrival", () => {
  const booking=fixture();
  booking.airportCode="JFK";
  booking.flightScheduledAt=new Date("2026-10-15T12:00:00Z");
  Object.assign(booking.flightDetails.verifiedBookingContext!,{airportCode:"JFK",scheduledAt:booking.flightScheduledAt.toISOString()});
  const update=driverFlightUpdate(booking,now);
  assert.equal(update.state,"current");
  assert.equal(update.airportRole,"departure");
  assert.equal(update.terminal,"8");
  assert.equal(update.gate,"B12");
  assert.equal(update.baggageBelt,null);
  assert.equal(update.estimatedTime,null);
  const overnight=fixture();
  overnight.flightDetails.flightDate="2026-10-14";
  overnight.flightDetails.scheduledDepartureTime="2026-10-15T02:00:00.000Z";
  Object.assign(overnight.flightDetails.verifiedBookingContext!,{flightDate:"2026-10-14",scheduledDepartureTime:overnight.flightDetails.scheduledDepartureTime});
  assert.equal(driverFlightUpdate(overnight,now).state,"current");
});
test("actual arrival and gate updates are provider-only, sanitized and removed on mismatch", () => {
  const booking=fixture();
  Object.assign(booking.flightDetails,{
    flightStatus:"landed", actualArrivalTime:"2026-10-15T16:18:00Z", arrivalGate:" D24 ",
  });
  const update=driverFlightUpdate(booking,now);
  assert.equal(update.status,"landed");
  assert.equal(update.actualTime,"2026-10-15T16:18:00.000Z");
  assert.equal(update.gate,"D24");
  for (const gate of [null,"", "   ",42,{gate:"fabricated"}]) {
    const details={...booking.flightDetails,arrivalGate:gate};
    assert.equal(driverFlightUpdate({...booking,flightDetails:details},now).gate,null);
  }
  const wrong=driverFlightUpdate({...booking,airportCode:"ORD"},now);
  assert.equal(wrong.state,"unavailable");
  assert.equal(wrong.actualTime,null);
  assert.equal(wrong.gate,null);
});
