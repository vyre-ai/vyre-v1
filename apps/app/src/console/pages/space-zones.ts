// Time zones as a person reads them: "Pacific Time, Los Angeles", not "America/Los_Angeles". A short list of the common zones; any other id reads as its name with the underscores taken out.
export const ZONE_LABELS: Readonly<Record<string, string>> = {
  "UTC": "UTC",
  "America/Los_Angeles": "Pacific Time, Los Angeles",
  "America/Denver": "Mountain Time, Denver",
  "America/Chicago": "Central Time, Chicago",
  "America/New_York": "Eastern Time, New York",
  "America/Sao_Paulo": "Brasilia Time, Sao Paulo",
  "Europe/London": "British Time, London",
  "Europe/Berlin": "Central European Time, Berlin",
  "Europe/Paris": "Central European Time, Paris",
  "Europe/Istanbul": "Turkey Time, Istanbul",
  "Africa/Cairo": "Eastern European Time, Cairo",
  "Africa/Lagos": "West Africa Time, Lagos",
  "Asia/Dubai": "Gulf Time, Dubai",
  "Asia/Karachi": "Pakistan Time, Karachi",
  "Asia/Kolkata": "India Time, Kolkata",
  "Asia/Dhaka": "Bangladesh Time, Dhaka",
  "Asia/Bangkok": "Indochina Time, Bangkok",
  "Asia/Kuala_Lumpur": "Malaysia Time, Kuala Lumpur",
  "Asia/Singapore": "Singapore Time, Singapore",
  "Asia/Shanghai": "China Time, Shanghai",
  "Asia/Tokyo": "Japan Time, Tokyo",
  "Australia/Sydney": "Eastern Australia Time, Sydney",
  "Pacific/Auckland": "New Zealand Time, Auckland",
};
export const TIME_ZONES: readonly string[] = Object.keys(ZONE_LABELS);
/** The label for a zone id; an id not in the list reads as its own name, underscores out. */
export const zoneLabel = (id: string): string => ZONE_LABELS[id] ?? id.replaceAll("_", " ");
