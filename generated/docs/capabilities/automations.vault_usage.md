# automations.vault_usage

Which Automation steps use which Vault item, by handle. Optionally one item. Only Automations the caller can see. A Vault value is never included.

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
| HTTP | POST /v1/automations/vault_usage |
| MCP tool | automations_vault_usage (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  handle?: string;
};
```

## Output

```ts
type Out = {
  uses: Array<{
      handle: string;
      automations: Array<{
          automationId: string;
          name: string;
          status: string;
          steps: Array<{
              nodeId: string;
              title: string;
            }>;
        }>;
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
    "handle": "#Dana_Lawmatics"
  },
  "output": {
    "uses": [
      {
        "automations": [
          {
            "automationId": "aut_a1b2c3",
            "name": "example",
            "status": "example",
            "steps": [
              {
                "nodeId": "example",
                "title": "example"
              }
            ]
          }
        ],
        "handle": "#Dana_Lawmatics"
      }
    ]
  }
}
```
