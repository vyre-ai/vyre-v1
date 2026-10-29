# automations.try_read

Try one read on a documented host. The Vault fills the key when the host sends it. The reply is only the level.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/try_read |
| MCP tool | automations_try_read (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  method: string;
  path: string;
  domains: Array<string>;
  markedSafe?: boolean;
  vaultItemId: string;
  actionKey?: string;
};
```

## Output

```ts
type Out = {
  level: "tested" | "draft";
  reason?: string;
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
    "actionKey": "example",
    "domains": [
      "example"
    ],
    "markedSafe": true,
    "method": "example",
    "path": "example",
    "vaultItemId": "example"
  },
  "output": {
    "level": "tested",
    "reason": "example"
  }
}
```
