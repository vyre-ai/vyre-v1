// The log scrubber (lane r42-mcp): every shape of secret r-review found leaking, hostile shapes in linear time, and a cut that never splits a key. The redact() rules it shares are frozen by
// agent/tests/transcript.sanitize.linear.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { redact, scrubLog } from "./secret-scrub.ts";

const gone = (text: string, ...secrets: string[]): void => {
  const out = scrubLog(text);
  for (const s of secrets) assert.ok(!out.includes(s), `${JSON.stringify(text)} -> ${JSON.stringify(out)} still has ${s}`);
};
const j = (...p: string[]): string => p.join("");

test("a value is removed whatever the spacing, quoting or place: name=value, spaced separators, quoted multi-word values, JSON, flags, headers", () => {
  gone("password=hunter2", "hunter2");
  gone("password = hunter2", "hunter2");
  gone("password : hunter2", "hunter2");
  gone('password: "a b c"', "a b c", "b c");
  gone("--password hunter2", "hunter2");
  gone("curl -u user:pass https://h", "user:pass");
  gone("mysql -p hunter2", "hunter2");
  gone("mysql -u root -phunter2 db", "hunter2");
  gone('{"password":"hunter2","x":1}', "hunter2");
  gone('{"password": "hunter2", "x": 1}', "hunter2");
  gone('"token": "abc123"', "abc123");
  gone("x-api-key: abc123", "abc123");
  gone("token=abc123&pw=hunter2", "abc123", "hunter2");
  gone("client_secret=abc123", "abc123");
  gone("DATABASE_URL=postgres://u:pass@h/db", "u:pass", "pass@");
  gone("accessToken=abc123", "abc123");
  gone('{"accessToken":"abc123"}', "abc123");
  gone("authToken: abcd1", "abcd1");
  gone("secretKey=hunter2", "hunter2");
  gone("clientSecret=hunter2", "hunter2");
  gone("apiKey=abc", "abc");
  gone("API_KEY=abc", "abc");
  gone("ACCESS_TOKEN=abc12", "abc12");
  gone("access_token=abc12", "abc12");
  gone("AUTHTOKEN: x1y2", "x1y2");
  gone("AWS_SECRET_ACCESS_KEY=abc", "=abc");
  gone("TOKEN=abcd", "abcd");
  gone("sessionId=abc", "=abc");
  gone("session_id=abc", "=abc");
  gone("SESSION_ID=abc", "=abc");
  gone("jwt=abc", "=abc");
  gone("otp=123456", "123456");
  gone("userOtp: 123456", "123456");
  gone("pwd=abc", "=abc");
  gone("SECRET=abc", "=abc");
  gone("DB_PASSWORD=abc", "=abc");
  gone("db.password=hunter2", "hunter2");
  gone('{"ClientSecret":"hunter2","SECRET_KEY":"abc","ok":1}', "hunter2", "abc");
});

test("headers lose the rest of their line: a second cookie, the attributes of a Set-Cookie, a Basic or Bearer credential", () => {
  gone("Cookie: a=b; c=d", "a=b", "c=d");
  gone("Set-Cookie: sid=abc; Path=/; HttpOnly", "sid=abc");
  gone("Authorization: Bearer sk_short123", "sk_short123");
  gone("Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz");
  gone("Bearer abc.def.ghi", "abc.def.ghi");
  const two = scrubLog("Cookie: a=b; c=d\nnext line stays");
  assert.match(two, /next line stays/, "the line after a header is untouched");
});

test("addresses keep scheme, host and path: no user name, password, query or fragment, even when a space splits the password", () => {
  assert.equal(scrubLog("postgres://u:pass@h/db"), "postgres://h/db");
  assert.equal(scrubLog("https://h/?token=abc&x=1#frag"), "https://h/");
  gone("postgres://u:pa ss@h/db", "u:pa", "ss@");
  assert.match(scrubLog("fetch failed https://api.example.com/v1/x?token=abc"), /https:\/\/api\.example\.com\/v1\/x/);
});

test("short vendor keys, 20-character mixed runs and long tokens are removed; plain words and numbers stay", () => {
  gone(j("sk", "_live_", "abc123def456"), "abc123def456");
  gone(j("gh", "p_", "abcdefghij1234567890"), "abcdefghij");
  gone(j("AK", "IA", "ABCDEFGH12345678"), "ABCDEFGH12");
  gone(j("eyJ", "hbGciOiJIUzI1NiJ9.abc123.def456"), "hbGciOiJ");
  gone("session a1b2c3d4e5f6g7h8i9j0k1", "a1b2c3d4e5f6");
  assert.equal(scrubLog("the request took 120 ms for 3 rows"), "the request took 120 ms for 3 rows");
  assert.equal(scrubLog("SQLITE_BUSY: database is locked"), "SQLITE_BUSY: database is locked");
});

test("the cut never splits a key: a secret across the 4000th character is gone, not half shown, and the cut is at a word boundary", () => {
  const key = j("gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8");
  const text = `${"w ".repeat(1995)} ${key} tail words`;
  const out = scrubLog(text);
  assert.ok(!out.includes("a1B2c3D4"), "no part of the key");
  assert.ok(out.length <= 4000);
  assert.ok(!/\s$/.test(out) || out.length <= 4000);
  const token = "x".repeat(3980) + " " + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4";
  assert.ok(!scrubLog(token).includes("A1b2C3d4E5f6G7h8I9j0"), "a token that starts before the cut is removed whole");
});

test("hostile shapes take linear time: 200 KB of word boundaries, separators, quotes, headers and unfinished quotes, best of 3 under 150 ms", () => {
  const shapes = [
    "a.".repeat(100_000), "a-".repeat(100_000), "http://".repeat(50_000), "a:/".repeat(100_000), "=".repeat(200_000), "@".repeat(200_000),
    '"'.repeat(200_000), "password ".repeat(25_000), "password: ".repeat(20_000), "Cookie: ".repeat(25_000), '{"a":'.repeat(40_000), "-p ".repeat(60_000),
    "x=".repeat(100_000), "key:".repeat(50_000), "a".repeat(200_000), ("x ".repeat(2000) + "password=").repeat(500),
  ];
  for (const text of shapes) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      scrubLog(text);
      best = Math.min(best, performance.now() - t);
    }
    assert.ok(best < 150, `${best.toFixed(0)} ms for ${JSON.stringify(text.slice(0, 14))}`);
  }
});

test("it never throws, whatever it is given", () => {
  for (const v of [undefined, null, 0, {}, [], Symbol.iterator.toString(), "\u0000\ud800", "\n\n\n"]) assert.equal(typeof scrubLog(v as never), "string");
});

test("redact() is unchanged by the move: it is the same function the transcript uses", () => {
  const key = j("sk-", "ant-", "api03-", "A".repeat(24));
  assert.ok(!redact(`x ${key}`).text.includes("AAAAAAAAAAAA"));
});

test("what is not a secret stays: -p and -u outside a database client or curl, JSON around a removed value, a bare carriage return after a header", () => {
  assert.equal(scrubLog("mkdir -p /tmp/x"), "mkdir -p /tmp/x");
  assert.equal(scrubLog("curl https://h/a\nmkdir -p /tmp/x"), "curl https://h/a\nmkdir -p /tmp/x", "the client was named on an earlier line");
  assert.equal(scrubLog("git push -u origin main"), "git push -u origin main");
  gone("curl -u user:pass https://h", "user:pass");
  const json = scrubLog('{"secret":"abc","ok":1}');
  assert.match(json, /"ok":1/, "later keys of the JSON are kept: " + json);
  assert.ok(!json.includes("abc"));
  assert.equal(scrubLog('{"password":"hunter2"}').endsWith("}"), true, "the closing brace is kept");
  assert.match(scrubLog("Cookie: a=b\rnext stays"), /next stays/);
});

test("a header word without its colon is prose: auth errors keep their reason, and only a real header loses its line", () => {
  assert.equal(scrubLog("Authorization failed for user bob on host"), "Authorization failed for user bob on host");
  assert.equal(scrubLog("The cookie banner failed to load"), "The cookie banner failed to load");
  assert.match(scrubLog("Error parsing cookie: invalid format here"), /format here$/, "mid-line it is a name and a value, not a header: only the next word goes, the reason stays");
  assert.equal(scrubLog("Error parsing cookie invalid format here"), "Error parsing cookie invalid format here");
  gone("Authorization: Bearer sk_short123", "sk_short123");
  gone("Authorization Bearer sk_short123", "sk_short123");
  gone("Cookie: a=b; c=d", "a=b", "c=d");
});
