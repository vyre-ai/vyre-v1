// Preloaded into a daemon process (NODE_OPTIONS=--import): sends requests meant for the model vendors below (OpenAI first) to VYRE_TEST_VENDOR, the local model stand-in. The daemon and its drivers are untouched.
const target = process.env.VYRE_TEST_VENDOR;
// the providers a walk adds a fixture key for: their key check and their turns reach the stand-in, never the real vendor
const HOSTS = ["https://api.openai.com", "https://api.anthropic.com", "https://openrouter.ai", "https://api.x.ai", "https://generativelanguage.googleapis.com"];
if (target) {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input?.url ?? input);
    const host = HOSTS.find((h) => url.startsWith(h));
    return real(host ? url.replace(host, target) : input, init);
  };
}
