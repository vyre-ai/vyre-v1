// A Space export waits for the saves in progress and then starts by itself; only a Space that never goes quiet answers "retry". True when nothing was writing by the end.
export async function waitForQuiet(inFlight: () => number, o: { stepMs?: number; maxSteps?: number } = {}): Promise<boolean> {
  const step = o.stepMs ?? 100, max = o.maxSteps ?? 200;
  for (let i = 0; i < max && inFlight() !== 0; i++) await new Promise<void>((resolve) => setTimeout(resolve, step));
  return inFlight() === 0;
}
