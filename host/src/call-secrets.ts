// The Vault values a call resolved, by trace id, so that an error thrown inside that call is scrubbed of them when the server logs it (invoke.ts). A seam that hands a plaintext value to a call (the Vault's
// read, a terminal or browser channel) calls noteCallSecret with the call's trace id; nested calls share the trace id. Bounded: it forgets everything past 2,000 traces.
const bySecrets = new Map<string, Set<string>>();

export function noteCallSecret(traceId: string, value: string): void {
  if (value.length < 4) return;
  if (bySecrets.size > 2000) bySecrets.clear();
  (bySecrets.get(traceId) ?? bySecrets.set(traceId, new Set()).get(traceId)!).add(value);
}
export const callSecretsOf = (traceId: string): readonly string[] => [...(bySecrets.get(traceId) ?? [])];
/** The call is over: its values are forgotten. */
export const forgetCallSecrets = (traceId: string): void => {
  bySecrets.delete(traceId);
};
