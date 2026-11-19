# automations.key_hosts.pending_bind

What a held key binding would do: the Vault keys (as the server reads them, for the person looking) and every domain of the connector. Names only, never a value.

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
| HTTP | POST /v1/automations/key_hosts/pending_bind |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connector?: string;
  secrets?: Record<string, string>;
  connectionId?: string;
  slot?: string;
  handle?: string;
  title?: string;
  ownerKind?: string;
  scopes?: Array<string>;
};
```

## Output

```ts
type Out = {
  found: boolean;
  items: Array<{
      itemId: string;
      handle: string;
      name: string;
    }>;
  hosts: Array<string>;
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
    "connectionId": "example",
    "connector": "example",
    "handle": "example",
    "ownerKind": "example",
    "scopes": [
      "example"
    ],
    "secrets": {},
    "slot": "example",
    "title": "example"
  },
  "output": {
    "found": true,
    "hosts": [
      "example"
    ],
    "items": [
      {
        "handle": "example",
        "itemId": "example",
        "name": "example"
      }
    ]
  }
}
```
