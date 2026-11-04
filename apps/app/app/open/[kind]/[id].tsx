// /open/<kind>/<id>: the address of one thing in a Space (the Copy link of the Share sheet). The root layout reads it and opens the thing through reach; this route only makes the address valid for the
// router and the static export.
export function generateStaticParams(): { kind: string; id: string }[] {
  return [{ kind: "file", id: "item" }];
}

export default function OpenRouteStub() {
  return null;
}
