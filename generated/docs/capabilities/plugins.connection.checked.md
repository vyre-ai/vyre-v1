# plugins.connection.checked

The host records what a connection last did: answered with N tools, wants a sign-in, refused its key, or did not answer; and which agent called it

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/plugins/connection/checked |
| MCP tool | none |
| CLI | none |
| Emits | plugin.connection_checked |

## Input

```ts
type In = {
  connectionId: string;
  health?: "ok" | "needs_signin" | "key_refused" | "not_answering" | "needs_setup" | "off" | "unknown";
  note?: string;
  tools?: number;
  usedBy?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "connectionId": "mcs_a1b2c3",
    "health": "ok",
    "note": "example",
    "tools": 1,
    "usedBy": "agt_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
