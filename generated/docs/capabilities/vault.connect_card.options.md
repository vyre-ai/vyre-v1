# vault.connect_card.options

Where the key can be kept: Mine, the shared folders an agent can use, and those it cannot

| | |
|---|---|
| Module | vault-requests |
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
| HTTP | POST /v1/vault/connect_card/options |
| MCP tool | vault_connect_card_options (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  folders: Array<{
      id: string;
      name: string;
      scope: "mine" | "shared";
      usable: boolean;
    }>;
  default?: string;
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
    "requestId": "vrq_a1b2c3"
  },
  "output": {
    "default": "vfd_a1b2c3",
    "folders": [
      {
        "id": "vfd_a1b2c3",
        "name": "example",
        "scope": "mine",
        "usable": true
      }
    ]
  }
}
```
