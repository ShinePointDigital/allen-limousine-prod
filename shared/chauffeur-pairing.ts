/** Fleet capacities entered during pairing must be positive, ascending seat counts. */
export function validPassengerCapacity(value: string): boolean {
  const capacity = value.trim();
  if (capacity.length > 30) return false;
  const match = capacity.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!match) return false;
  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  return low > 0 && high >= low && high <= 100;
}
