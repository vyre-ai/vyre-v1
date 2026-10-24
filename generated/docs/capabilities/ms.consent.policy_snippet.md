# ms.consent.policy_snippet

PowerShell for the Exchange application access policy, limited to the mapped members, for a tenant admin to run

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/consent/policy_snippet |
| MCP tool | ms_consent_policy_snippet (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  language: "powershell";
  snippet: string;
  groupName: string;
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
  "input": {},
  "output": {
    "groupName": "example",
    "language": "powershell",
    "snippet": "example"
  }
}
```
