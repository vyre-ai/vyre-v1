# members.second_factor.report

Who has a second factor and who does not (when the floor is on, the ones locked out soon)

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/members/second_factor/report |
| MCP tool | members_second_factor_report (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  people: Array<{
      person: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      name: string;
      factors: Array<"totp" | "passkey">;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "people": [
      {
        "factors": [
          "totp"
        ],
        "name": "example",
        "person": {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      }
    ],
    "total": 1
  }
}
```
