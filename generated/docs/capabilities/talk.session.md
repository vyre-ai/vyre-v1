# talk.session

Open one Talk session: mints a short-lived provider token and the socket address. Own key first, then the Space key. Audited per person; the key itself never leaves the server

| | |
|---|---|
| Module | talk |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/talk/session |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  provider: string;
  url: string;
  protocols: Array<string>;
  context?: string;
  source: "own" | "space";
  expiresIn: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "context": "example",
    "expiresIn": 1,
    "protocols": [
      "example"
    ],
    "provider": "deepgram",
    "source": "own",
    "url": "example"
  }
}
```
