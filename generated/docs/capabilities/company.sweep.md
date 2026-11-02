# company.sweep

Check the directory: a person gone from it stops and loses access. Runs on a schedule; a person confirms a change large enough to be held

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/company/sweep |
| MCP tool | company_sweep (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  confirmed?: boolean;
};
```

## Output

```ts
type Out = {
  checked: number;
  gone: Array<string>;
  held?: string;
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
    "confirmed": true
  },
  "output": {
    "checked": 1,
    "gone": [
      "maya@example.com"
    ],
    "held": "example"
  }
}
```
