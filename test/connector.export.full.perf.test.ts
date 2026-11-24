// The connector export at the full size of the firm's Space (28,000 contacts, 9,400 matters of 100 fields, 1,100 organizations) against the full 15,000 ms bound. The gate runs the same file at 70%
// with the bound scaled (test/connector.export.live.test.ts); a speed number counts only on the v1-perf runners (ruling 46), so the full size lives here.
process.env["EXPORT_SCALE"] = "1";
await import("./connector.export.live.test.ts");
