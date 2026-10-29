// Preloaded into a daemon process (NODE_OPTIONS=--import): sends requests meant for api.openai.com to VYRE_TEST_VENDOR, the local model stand-in. The daemon and its drivers are untouched.
const target = process.env.VYRE_TEST_VENDOR;
if (target) {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input?.url ?? input);
    return real(url.startsWith("https://api.openai.com") ? url.replace("https://api.openai.com", target) : input, init);
  };
}
