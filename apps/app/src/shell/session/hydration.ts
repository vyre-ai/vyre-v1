/** SSR and the first browser render stay address-neutral; the mounted render may discover the page origin. */
export function hydrationBaseUrl(mounted: boolean): null | undefined {
  return mounted ? undefined : null;
}
