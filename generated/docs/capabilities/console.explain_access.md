# console.explain_access

Explain why a person can or cannot see a thing, in the words of the Access checker steps

| | |
|---|---|
| Module | console-assistant |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | access.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/explain_access |
| MCP tool | console_explain_access (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person: string;
  action: string;
  resourceType: string;
  resourceId: string;
};
```

## Output

```ts
type Out = {
  effect: "allow" | "deny" | "hold";
  steps: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "action": "example",
    "person": "usr_a1b2c3",
    "resourceId": "example",
    "resourceType": "example"
  },
  "output": {
    "effect": "allow",
    "steps": [
      "example"
    ]
  }
}
```
