export type DriverTripNextStatus = "EN_ROUTE" | "IN_PROGRESS" | "COMPLETED";

export function nextDriverTripStatus(status: string): DriverTripNextStatus | null {
  if (status === "ASSIGNED" || status === "CONFIRMED") return "EN_ROUTE";
  if (status === "EN_ROUTE") return "IN_PROGRESS";
  if (status === "IN_PROGRESS") return "COMPLETED";
  return null;
}

export function driverNavigationUrls(destination: string) {
  const encoded = encodeURIComponent(destination);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
    apple: `https://maps.apple.com/?daddr=${encoded}`,
    waze: `https://www.waze.com/ul?q=${encoded}&navigate=yes`,
  };
}
