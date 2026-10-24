// twilio: rows for the seeded Space. Numbers arrive through twilio.number.buy, not the seed.
export const seed = { table: "twilio_number", rows: [] as { sid: string; e164: string }[] };
