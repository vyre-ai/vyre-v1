// What a cloud machine costs, and what is known of the sizes (lane l-ci-runners).
// DigitalOcean's rule (docs.digitalocean.com/products/droplets/details/pricing, read 4 Nov 2026):
//   "Bundled-plan CPU Droplets are billed per second with a minimum charge of 60 seconds or $0.01, whichever is higher."
//   "Usage is capped at 672 hours (28 days) per month."
//   "You are still billed for bundled-plan CPU Droplets that are powered off": only deleting the machine stops the bill, which is why every machine is deleted and a sweeper backs that up.
// So the cost of one machine is its hourly price times the seconds it lived (at least 60), never under one cent, and rounded UP to a hundredth of a cent so a total never undercounts.
// The hourly prices are the published ones for the sizes below; a size not listed is refused in the settings, so a cost is never a guess.
export const PRICE_HOURLY: Readonly<Record<string, number>> = {
  "s-1vcpu-1gb": 0.00893, "s-1vcpu-2gb": 0.01786, "s-2vcpu-2gb": 0.02679, "s-2vcpu-4gb": 0.03571, "s-4vcpu-8gb": 0.07143, "s-8vcpu-16gb": 0.14286,
};
export const MIN_SECONDS = 60;
export const MIN_CHARGE_USD = 0.01;
export const MAX_BILLED_HOURS_MONTH = 672;

/** The cost in dollars of one machine that lived `seconds` at `priceHourly`. */
export function costOf(priceHourly: number, seconds: number): number {
  const billed = Math.max(MIN_SECONDS, Math.ceil(Math.max(0, seconds)));
  const raw = (priceHourly * billed) / 3600;
  return Math.ceil(Math.max(MIN_CHARGE_USD, raw) * 10_000 - 1e-9) / 10_000;
}
