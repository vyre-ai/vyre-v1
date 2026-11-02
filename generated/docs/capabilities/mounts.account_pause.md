# mounts.account_pause

The connector stops or restarts everything that syncs as one address; the folders stay

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mounts/account_pause |
| MCP tool | none |
| CLI | none |
| Emits | mount.paused, mount.resumed |

## Input

```ts
type In = {
  account: string;
  paused: boolean;
};
```

## Output

```ts
type Out = {
  changed: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "account": "example",
    "paused": true
  },
  "output": {
    "changed": 1
  }
}
```
