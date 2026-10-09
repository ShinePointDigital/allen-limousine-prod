export type DispatchWizardStep = 1 | 2 | 3 | 4;
export type WizardSmsStatus = "NOT_STARTED" | "RESERVED" | "PENDING" | "SENT" | "FAILED" | "SKIPPED";
export type WizardSmsPreview = {
  recipient: "DRIVER" | "CUSTOMER";
  toPhone: string;
  body: string;
  status: WizardSmsStatus;
  attemptId: string | null;
  providerMessageId: string | null;
  deliveryStatus: string | null;
  errorMessage: string | null;
};
export type DispatchWizardSnapshot = {
  booking: {
    id: string; fullName: string; phone: string; pickup: string; destination: string;
    pickupAt: string; vehicleClass: string; status: string; dispatchStatus: string;
    reviewedAt: string | null; smsConsent: boolean;
  };
  version: number;
  step: DispatchWizardStep;
  completed: boolean;
  blocked: string | null;
  drivers: {
    id: string; name: string; phone: string; fleetVehicleId: string | null;
    vehicleName: string | null; vehicleCategory: string | null;
    available: boolean; pairable: boolean;
  }[];
  vehicles: {
    id: string; name: string; category: string;
    pairedToDriverId: string | null; available: boolean; pairable: boolean;
  }[];
  assignment: { rideId: string | null; driverId: string | null; driverName: string | null; driverPhone: string | null; vehicleId: string | null; vehicleName: string | null };
  messages: { driver: WizardSmsPreview; customer: WizardSmsPreview };
};
