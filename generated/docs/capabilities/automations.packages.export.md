# automations.packages.export

Save a portable copy of an Automation definition; connections become slots and no secret, Vault value or run data is carried

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/packages/export |
| MCP tool | automations_packages_export (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
  name?: string;
};
```

## Output

```ts
type Out = {
  package: {
    id: string;
    name: string;
    sourceAutomationId: string;
    createdAt: number;
    requires: {
      connections: Array<{
          slot: string;
          label: string;
          stepIds: Array<string>;
        }>;
      vault: Array<string>;
      keys: Array<string>;
    };
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.not_found
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3",
    "name": "example"
  },
  "output": {
    "package": {
      "createdAt": 1760000000000,
      "id": "example",
      "name": "example",
      "requires": {
        "connections": [
          {
            "label": "example",
            "slot": "example",
            "stepIds": [
              "example"
            ]
          }
        ],
        "keys": [
          "example"
        ],
        "vault": [
          "example"
        ]
      },
      "sourceAutomationId": "aut_a1b2c3"
    }
  }
}
```
