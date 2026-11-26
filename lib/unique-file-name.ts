// A name for a new file that is not taken in its folder: the plain name, else "name (2).ext", "(3)" and so on, the first number nobody has used among the names the caller can see. The folder is listed once; when the create
// still finds the name taken (a race, or a file the caller cannot see), the next numbers are tried a few times, then a short random suffix, so a call never fails over a name and never makes a thousand attempts.
const MAX_TRIES = 5;

export function numbered(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** The first number whose name is not in `taken`. */
export function firstFree(name: string, taken: ReadonlySet<string>): number {
  let n = 1;
  while (taken.has(numbered(name, n))) n++;
  return n;
}

const isDuplicate = (e: unknown): boolean =>
  ((e as { error?: { code?: unknown }; code?: unknown } | null)?.error?.code ??
    (e as { code?: unknown } | null)?.code) === "validation.duplicate";

/**
 * Make a file under a free name. `listNames` is asked once (the names the caller can see in the folder); `create(name, attempt)` makes the file and throws the Files duplicate error when the name is taken.
 * At most MAX_TRIES creates with the next free numbers, then one with a random suffix.
 */
export async function createUnique<T>(
  name: string,
  listNames: () => Promise<Iterable<string>>,
  create: (name: string, attempt: number) => Promise<T>,
  random: () => string = () => Math.random().toString(36).slice(2, 7),
): Promise<T> {
  let taken: Set<string>;
  try {
    taken = new Set(await listNames());
  } catch {
    taken = new Set();
  }
  let n = firstFree(name, taken);
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++, n++) {
    try {
      return await create(numbered(name, n), attempt);
    } catch (e) {
      if (!isDuplicate(e)) throw e;
    }
  }
  const dot = name.lastIndexOf(".");
  const suffixed = dot > 0 ? `${name.slice(0, dot)}-${random()}${name.slice(dot)}` : `${name}-${random()}`;
  return create(suffixed, MAX_TRIES + 1);
}
