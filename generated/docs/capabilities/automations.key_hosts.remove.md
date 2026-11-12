# automations.key_hosts.remove

A person who may use a Vault key removes a host it was approved for. The next use of the key there waits for a person again.

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
| HTTP | POST /v1/automations/key_hosts/remove |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
  host: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "itemId": "example"
  },
  "output": {
    "removed": true
  }
}
```
