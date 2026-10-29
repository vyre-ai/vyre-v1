# automations.dependencies

What every visible automation names: other automations, connections, mailboxes, forms and more, with who uses each and what is missing or off

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
| HTTP | POST /v1/automations/dependencies |
| MCP tool | automations_dependencies (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  automations: number;
  items: Array<{
      kind: string;
      ref: string;
      problem: ("missing" | "off") | null;
      usedBy: Array<{
          automationId: string;
          name: string;
          status: string;
          stepIds: Array<string>;
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
  "input": {},
  "output": {
    "automations": 1,
    "items": [
      {
        "kind": "example",
        "problem": "missing",
        "ref": "example",
        "usedBy": [
          {
            "automationId": "aut_a1b2c3",
            "name": "example",
            "status": "example",
            "stepIds": [
              "example"
            ]
          }
        ]
      }
    ]
  }
}
```
