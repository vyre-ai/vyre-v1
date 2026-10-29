# automations.packages.list

List portable Automation packages this person has exported

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
| HTTP | POST /v1/automations/packages/list |
| MCP tool | automations_packages_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  packages: Array<{
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
  "input": {},
  "output": {
    "packages": [
      {
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
    ]
  }
}
```
