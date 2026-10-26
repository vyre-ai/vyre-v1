// One route per place, so the static export has a page for each and a deep link (/records) lands on it. The shell in _layout draws the place and UrlSync opens the one the address names.
import { PLACES } from "../src/startup/places.ts";

export function generateStaticParams(): { place: string }[] {
  const params: { place: string }[] = [];
  for (const place of PLACES) params.push({ place });
  return params;
}

export default function PlaceRoute() {
  return null;
}
