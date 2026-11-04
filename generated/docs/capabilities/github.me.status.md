# github.me.status

Is my GitHub connected, as whom, through which app, and does it need connecting again

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/github/me/status |
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
  connected: boolean;
  login?: string;
  source?: "space" | "vyre";
  connectedAt?: number;
  needsReconnect: boolean;
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
  "input": {},
  "output": {
    "connected": true,
    "connectedAt": 1760000000000,
    "login": "example",
    "needsReconnect": true,
    "source": "space"
  }
}
```
