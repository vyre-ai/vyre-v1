// Fake Stripe behind api.stripe.com (ARCH 8 table, 10.1). Health is GET /v1/balance.
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export interface StripeBalance {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export interface StripeProvider {
  readonly name: "stripe";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  balance(): Promise<StripeBalance>;
  createCustomer(input: { email?: string; name?: string }): Promise<{ id: string; email: string | null }>;
}

export function fakeStripe(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): StripeProvider {
  const calls: SeenCall[] = [];
  let n = 0;
  const handlers: Handler[] = [
    {
      method: "GET",
      match: (u) => hostIs(u, "stripe.com") && u.pathname === "/v1/balance",
      run: () => ({ body: { object: "balance", available: [{ amount: 0, currency: "usd" }], pending: [] } }),
    },
    {
      method: "POST",
      match: (u) => hostIs(u, "stripe.com") && u.pathname === "/v1/customers",
      run: (_u, init) => {
        n += 1;
        const parsed = init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
        return {
          body: {
            id: `cus_${n}`,
            object: "customer",
            email: typeof parsed.email === "string" ? parsed.email : null,
            name: typeof parsed.name === "string" ? parsed.name : null,
          },
        };
      },
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);
  return {
    name: "stripe",
    calls,
    fetch,
    async balance() {
      const res = await fetch("https://api.stripe.com/v1/balance");
      if (res.status !== 200) throw new Error(`stripe balance returned ${res.status}`);
      return JSON.parse(await res.text()) as StripeBalance;
    },
    async createCustomer(input) {
      const res = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.status !== 200) throw new Error(`stripe customer returned ${res.status}`);
      return JSON.parse(await res.text()) as { id: string; email: string | null };
    },
  };
}
