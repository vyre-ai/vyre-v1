# company.guide

The guide for a step of Connect your company, or all of it: the doc page itself

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/company/guide |
| MCP tool | company_guide (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  provider: "google" | "microsoft";
  section?: string;
};
```

## Output

```ts
type Out = {
  text: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "provider": "google",
    "section": "example"
  },
  "output": {
    "text": "example"
  }
}
```
