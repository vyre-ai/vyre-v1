const SHIM = new URL("./rn-web-shim.mjs", import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react-native") return { url: SHIM, shortCircuit: true, format: "module" };
  return nextResolve(specifier, context);
}
