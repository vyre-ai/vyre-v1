# automations.key_hosts.pending

What a held test read would send: the Vault item (as the server reads the reference, for the person looking) and the host. The card names the key from this. Names only, never a value.

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
| HTTP | POST /v1/automations/key_hosts/pending |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  method?: string;
  path: string;
  domains: Array<string>;
  vaultItemId: string;
  header?: string;
  prefix?: string;
  actionKey?: string;
  markedSafe?: boolean;
};
```

## Output

```ts
type Out = {
  found: boolean;
  itemId?: string;
  handle?: string;
  name?: string;
  host?: string;
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
    "header": "example",
    "markedSafe": true,
    "method": "example",
    "path": "example",
    "prefix": "example",
    "vaultItemId": "example"
  },
  "output": {
    "found": true,
    "handle": "example",
    "host": "example",
    "itemId": "example",
    "name": "example"
  }
}
```
