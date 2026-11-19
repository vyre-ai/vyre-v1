// rc.40: redact() runs on every transcript and tool result, so no pattern may take more than linear time, and the same secrets must still be caught.
// The frozen outputs below are what redact() gave on rc.39 for each sample (the secrets are assembled from pieces, as in transcript.sanitize.test.ts);
// the one deliberate change is the name of the rule that catches a clipped private key block ("pem", it was "pem-open").
import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/transcript/index.ts";

const j = (...p: string[]): string => p.join("");
const BEG = (k: string): string => j("-----BEGIN ", k, "PRIVATE ", "KEY-----");
const END = (k: string): string => j("-----END ", k, "PRIVATE ", "KEY-----");
const V = "zz9Q8w7e6r5t4y3u2i1o";
const S = [
  j("sk-", "ant-", "api03-", "A".repeat(24)),
  j("sk-", "proj-", "Zy9".repeat(10)),
  j("sk", "_live_", "NorthwindBakery0000fake12"),
  j("gh", "p_", "a1B2".repeat(8)),
  j("AK", "IA", "ABCDEFGHIJKLMNOP"),
  j("xox", "b-", "1234567890-abcdefghij"),
  j("AI", "za", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6"),
  ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join("."),
  j("Bear", "er ", "q".repeat(30)),
  j("SG", ".", "a".repeat(22), ".", "b".repeat(22)),
  j("npm", "_", "c".repeat(36)),
  `aws_secret_access_key = ${"Ab1/+=".repeat(7).slice(0, 40)}`,
  `AWS_SECRET_ACCESS_KEY: ${"Zz9".repeat(14).slice(0, 40)}`,
  `aws_secret_access_key=${"A".repeat(40)}`,
  `API_KEY=${V}`,
  `{"clientSecret": "${V}"}`,
  `export STRIPE_TOKEN=${V}`,
  `export "DB_PASSWORD"='${V}'`,
  `db.password = ${V}`,
  `my-secret: ${V}`,
  `auth=${V}`,
  `token: ${V}`,
  `apiKey = ${V}`,
  `config.apiKey="${V}"`,
  `X_AUTH_TOKEN=${V}x`,
  `SECRET_FILE=${V}`,
  `TOKEN_PATH=${V}`,
  `foo=token=${V}`,
  `x=ab; api_key=${V}`,
  `key=${V}`,
  `keyboard=${V}`,
  `monkey=${V}`,
  "DATABASE_URL=postgres://app:hunter2secret@db.internal:5432/x",
  "redis://:pass1234word@host:6379",
  "mongodb+srv://u:p4ssw0rdlong@cluster.example/db",
  "mysql -h db -u root -pMyS3cretPass",
  "curl -u admin:s3cr3tvalue https://x.test",
  "password: correct-horse-battery",
  "PASSWORD=correct-horse-battery",
  "db_passwd: correct-horse-battery",
  "passphrase = 'correct horse battery'",
  "pass=short",
  "my.password=correct-horse-battery",
  "x_pass:  longvalue12345",
  `{"password":"${V}"}`,
  `${BEG("RSA ")}\nMIIEowIBAAKCAQEAxyz\nabc\n${END("RSA ")} after`,
  `paste: ${BEG("")}\nMIIEow\nabc`,
  `a ${BEG("")}\nx\n${END("")} b ${BEG("EC ")}\ny\n${END("EC ")} c`,
  "cache_key=abcdefghijklmnop",
  "token_count: 123456789012",
  "NODE_ENV=production",
  "const key = process.env.API_KEY",
  "api_key=${API_KEY_VALUE_HERE}",
  "token=<your-token-here-xxxxxx>",
  "secret=changeme-changeme-changeme",
  "keychain=abcdefghijklmnopqrstuvwxyz",
  "apiKey = config.keys.primary.value",
  "public_key=ssh-ed25519AAAAC3NzaC1lZDI1NTE5AAAA",
  "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
  "hello world, nothing secret here: a=b, c=d",
  "line one\nTOKEN=abcdefghijklmnopqrst\nline three\nSecret: abcdefghijklmnopqrstuv",
  `clientSecret:${V}`,
  `refresh_token="${V}"`,
  `Session-Token: ${V}`,
  `private.key=${V}`,
];

const EXPECT: Array<{ text: string; hits: string[] }> = [
  {
    text: "[Anthropic key redacted …AAAA]",
    hits: ["anthropic"],
  },
  {
    text: "[API key redacted …9Zy9]",
    hits: ["openai"],
  },
  {
    text: "[Stripe key redacted …ke12]",
    hits: ["stripe"],
  },
  {
    text: "[GitHub token redacted …a1B2]",
    hits: ["github"],
  },
  {
    text: "[AWS key id redacted …MNOP]",
    hits: ["aws"],
  },
  {
    text: "[Slack token redacted …ghij]",
    hits: ["slack"],
  },
  {
    text: "[Google key redacted …O5p6]",
    hits: ["google"],
  },
  {
    text: "[JWT redacted …sR8U]",
    hits: ["jwt"],
  },
  {
    text: "[bearer token redacted …qqqq]",
    hits: ["bearer"],
  },
  {
    text: "[SendGrid key redacted …bbbb]",
    hits: ["sendgrid"],
  },
  {
    text: "[npm token redacted …cccc]",
    hits: ["npm"],
  },
  {
    text: "aws_secret_access_key = [AWS secret redacted …Ab1/]",
    hits: ["aws-secret"],
  },
  {
    text: "AWS_SECRET_ACCESS_KEY: [AWS secret redacted …Zz9Z]",
    hits: ["aws-secret"],
  },
  {
    text: "aws_secret_access_key=[AWS secret redacted …AAAA]",
    hits: ["aws-secret"],
  },
  {
    text: "API_KEY=[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: '{"clientSecret": "[secret redacted …2i1o]"}',
    hits: ["named-secret"],
  },
  {
    text: "export STRIPE_TOKEN=[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "export \"DB_PASSWORD\"='[password redacted …2i1o]'",
    hits: ["password"],
  },
  {
    text: "db.password = [password redacted …2i1o]",
    hits: ["password"],
  },
  {
    text: "my-secret: [secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "auth=[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "token: [secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "apiKey = [secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: 'config.apiKey="[secret redacted …2i1o]"',
    hits: ["named-secret"],
  },
  {
    text: "X_AUTH_TOKEN=[secret redacted …i1ox]",
    hits: ["named-secret"],
  },
  {
    text: "SECRET_FILE=zz9Q8w7e6r5t4y3u2i1o",
    hits: [],
  },
  {
    text: "TOKEN_PATH=zz9Q8w7e6r5t4y3u2i1o",
    hits: [],
  },
  {
    text: "foo=token=[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "x=ab; api_key=[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "key=[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "keyboard=zz9Q8w7e6r5t4y3u2i1o",
    hits: [],
  },
  {
    text: "monkey=zz9Q8w7e6r5t4y3u2i1o",
    hits: [],
  },
  {
    text: "DATABASE_URL=postgres://app:[url password redacted …cret]@db.internal:5432/x",
    hits: ["conn-url"],
  },
  {
    text: "redis://:pass1234word@host:6379",
    hits: [],
  },
  {
    text: "mongodb+srv://u:[url password redacted …long]@cluster.example/db",
    hits: ["conn-url"],
  },
  {
    text: "mysql -h db -u root -p[password redacted …Pass]",
    hits: ["db-flag-password"],
  },
  {
    text: "curl -u admin:[password redacted …alue] https://x.test",
    hits: ["curl-userpass"],
  },
  {
    text: "password: [password redacted …tery]",
    hits: ["password"],
  },
  {
    text: "PASSWORD=[password redacted …tery]",
    hits: ["password"],
  },
  {
    text: "db_passwd: [password redacted …tery]",
    hits: ["password"],
  },
  {
    text: "passphrase = 'correct horse battery'",
    hits: [],
  },
  {
    text: "pass=short",
    hits: [],
  },
  {
    text: "my.password=[password redacted …tery]",
    hits: ["password"],
  },
  {
    text: "x_pass:  [password redacted …2345]",
    hits: ["password"],
  },
  {
    text: '{"password":"[password redacted …2i1o]"}',
    hits: ["password"],
  },
  {
    text: "[private key redacted] after",
    hits: ["pem"],
  },
  {
    text: "paste: [private key redacted]",
    hits: ["pem"],
  },
  {
    text: "a [private key redacted] b [private key redacted] c",
    hits: ["pem", "pem"],
  },
  {
    text: "cache_key=abcdefghijklmnop",
    hits: [],
  },
  {
    text: "token_count: 123456789012",
    hits: [],
  },
  {
    text: "NODE_ENV=production",
    hits: [],
  },
  {
    text: "const key = process.env.API_KEY",
    hits: [],
  },
  {
    text: "api_key=${API_KEY_VALUE_HERE}",
    hits: [],
  },
  {
    text: "token=<your-token-here-xxxxxx>",
    hits: [],
  },
  {
    text: "secret=changeme-changeme-changeme",
    hits: [],
  },
  {
    text: "keychain=abcdefghijklmnopqrstuvwxyz",
    hits: [],
  },
  {
    text: "apiKey = config.keys.primary.value",
    hits: [],
  },
  {
    text: "public_key=ssh-ed25519AAAAC3NzaC1lZDI1NTE5AAAA",
    hits: [],
  },
  {
    text: "Authorization: [bearer token redacted …2345]",
    hits: ["bearer"],
  },
  {
    text: "hello world, nothing secret here: a=b, c=d",
    hits: [],
  },
  {
    text: "line one\nTOKEN=[secret redacted …qrst]\nline three\nSecret: [secret redacted …stuv]",
    hits: ["named-secret", "named-secret"],
  },
  {
    text: "clientSecret:[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: 'refresh_token="[secret redacted …2i1o]"',
    hits: ["named-secret"],
  },
  {
    text: "Session-Token: [secret redacted …2i1o]",
    hits: ["named-secret"],
  },
  {
    text: "private.key=[secret redacted …2i1o]",
    hits: ["named-secret"],
  },
];

test("redact gives the same result on a fixed set of real-shaped secrets and look-alikes", () => {
  assert.equal(S.length, EXPECT.length);
  S.forEach((s, i) => assert.deepEqual(redact(s), EXPECT[i], s.slice(0, 60)));
});

const M = 5_000_000;
const SHAPES: Array<[string, string]> = [
  ["password: a_ run", "a_".repeat(M / 2)],
  ["named secret: a. run", "a.".repeat(M / 2)],
  ["url password: a+ run", "a+".repeat(M / 2)],
  ["aws secret: space run", "aws_secret_access_key" + " ".repeat(M)],
  ["a space run", "x" + " ".repeat(M) + "!"],
  ["clipped keys", `${BEG("")}\n`.repeat(M / 28)],
  ["mysql run", "mysql ".repeat(M / 6)],
  ["db flag run", " -pabcdefgh".repeat(M / 11)],
  ["token= run", "token=".repeat(M / 6)],
  ["a name run", "a".repeat(M)],
];

test("5 MB of each hostile shape takes well under a second in all (the quadratic patterns took 2 to 5 s at 100 KB)", () => {
  let total = 0;
  for (const [label, text] of SHAPES) {
    // the best of two runs: a busy runner can stall one run, a quadratic pattern is slow in both
    let best = Infinity;
    for (let k = 0; k < 2; k += 1) {
      const t0 = performance.now();
      redact(text);
      best = Math.min(best, performance.now() - t0);
    }
    if (SHAPES.findIndex(([l]) => l === label) < 4) total += best;
    assert.ok(best < 700, `${label}: ${Math.round(best)} ms`);
  }
  assert.ok(total < 1000, `the four quadratic shapes together: ${Math.round(total)} ms`);
});
