# mcp.session.mint

Mint the loopback session for a CLI engine: a session token that encodes principal, acting-for person, thread, run and trace

| | |
|---|---|
| Module | mcp |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/mcp/session/mint |
| MCP tool | none |
| CLI | none |
| Emits | mcp.session_started |

## Input

```ts
type In = {
  principal: string;
  actingFor: string;
  threadId: string;
  runId?: string;
  traceId: string;
  ttlSec?: number;
};
```

## Output

```ts
type Out = {
  sessionId: string;
  sessionToken: string;
  url: string;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "actingFor": "example",
    "principal": "example",
    "runId": "run_a1b2c3",
    "threadId": "thr_a1b2c3",
    "traceId": "0123456789abcdef0123456789abcdef",
    "ttlSec": 60
  },
  "output": {
    "expiresAt": 1760000000000,
    "sessionId": "ses_a1b2c3",
    "sessionToken": "example",
    "url": "http://127.0.0.1:41800/mcp"
  }
}
```
