# automations.key_hosts.list

The hosts a person approved for one Vault key: a key is sent only to these, or to the host of the item's own saved address. Names only, never a value.

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
| HTTP | POST /v1/automations/key_hosts/list |
| MCP tool | automations_key_hosts_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
};
```

## Output

```ts
type Out = {
  hosts: Array<{
      host: string;
      by: string;
      at: number;
      usedBy: Array<string>;
      hidden?: number;
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
    "itemId": "example"
  },
  "output": {
    "hosts": [
      {
        "at": 1,
        "by": "example",
        "hidden": 1,
        "host": "example",
        "usedBy": [
          "example"
        ]
      }
    ]
  }
}
```
