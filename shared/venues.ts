export type EventVenue = {
  slug: string;
  name: string;
  aliases: string[];
  surchargeCents: number;
};

export const CHICAGO_EVENT_VENUES: EventVenue[] = [
  {
    slug: "united-center",
    name: "United Center",
    aliases: ["united center", "1901 w madison st", "1901 west madison street"],
    surchargeCents: 2500,
  },
  {
    slug: "soldier-field",
    name: "Soldier Field",
    aliases: ["soldier field", "1410 museum campus dr", "1410 museum campus drive"],
    surchargeCents: 2500,
  },
  {
    slug: "wrigley-field",
    name: "Wrigley Field",
    aliases: ["wrigley field", "1060 w addison st", "1060 west addison street"],
    surchargeCents: 3000,
  },
  {
    slug: "northerly-island",
    name: "Northerly Island",
    aliases: ["northerly island", "1521 s linn white dr", "1521 south linn white drive"],
    surchargeCents: 2500,
  },
  {
    slug: "allstate-arena",
    name: "Allstate Arena",
    aliases: ["allstate arena", "6920 n manheim rd", "6920 north manheim road"],
    surchargeCents: 3000,
  },
];

const normalizeVenueText = (value: string) => value
  .toLowerCase()
  .replace(/[^\da-z]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function detectEventVenue(address: string): EventVenue | null {
  const normalizedAddress = normalizeVenueText(address);
  return CHICAGO_EVENT_VENUES.find(venue =>
    venue.aliases.some(alias => normalizedAddress.includes(normalizeVenueText(alias))),
  ) || null;
}