# automations.key_hosts.allow

A person who may use a Vault key approves one host it may be sent to. A person only.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/key_hosts/allow |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  vaultItemId: string;
  host: string;
};
```

## Output

```ts
type Out = {
  hosts: Array<{
      host: string;
      by: string;
      at: number;
    }>;
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
    "host": "example",
    "vaultItemId": "example"
  },
  "output": {
    "hosts": [
      {
        "at": 1,
        "by": "example",
        "host": "example"
      }
    ]
  }
}
```
