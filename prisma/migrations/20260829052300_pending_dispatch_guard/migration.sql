-- Prevent concurrent or repeated sends while a provider outcome is unresolved.
CREATE UNIQUE INDEX "DispatchMessage_one_pending_per_ride_idx"
ON "DispatchMessage"("rideId")
WHERE "status" = 'PENDING';