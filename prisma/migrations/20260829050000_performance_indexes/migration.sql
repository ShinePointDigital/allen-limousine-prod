CREATE INDEX "Inquiry_status_createdAt_idx" ON "Inquiry"("status", "createdAt");
CREATE INDEX "Inquiry_email_idx" ON "Inquiry"("email");
CREATE INDEX "Inquiry_pickupAt_idx" ON "Inquiry"("pickupAt");
CREATE INDEX "Service_active_sortOrder_idx" ON "Service"("active", "sortOrder");
CREATE INDEX "FleetVehicle_active_sortOrder_idx" ON "FleetVehicle"("active", "sortOrder");