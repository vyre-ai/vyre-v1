// Loaded (node --import, through NODE_OPTIONS so the processes a test starts carry it too) only by scripts/test-run.ts. It is how product code knows it runs inside the test runner (host/src/test-mode.ts):
// a variable a person could copy into a server's environment is not enough to turn a test switch on.
globalThis[Symbol.for("vyre.test-runner")] = true;
