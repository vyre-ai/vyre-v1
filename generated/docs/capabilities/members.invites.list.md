# members.invites.list

List invites

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | members.invite |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/members/invites/list |
| MCP tool | members_invites_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state?: "open" | "accepted" | "revoked" | "expired";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  invites: Array<{
      id: string;
      role: string;
      groups: Array<string>;
      agents: Array<string>;
      projects: Array<string>;
      channels: Array<string>;
      email?: string;
      expiresAt: number;
      createdBy: string;
      state: "open" | "accepted" | "revoked" | "expired";
      aiKeyHandle?: string;
      acceptedBy?: string;
      createdAt: number;
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
    "limit": 1,
    "state": "open"
  },
  "output": {
    "invites": [
      {
        "acceptedBy": "usr_a1b2c3",
        "agents": [
          "agt_a1b2c3"
        ],
        "aiKeyHandle": "#Dana_Lawmatics",
        "channels": [
          "chn_a1b2c3"
        ],
        "createdAt": 1760000000000,
        "createdBy": "usr_a1b2c3",
        "email": "maya@example.com",
        "expiresAt": 1760000000000,
        "groups": [
          "grp_a1b2c3"
        ],
        "id": "inv_a1b2c3",
        "projects": [
          "prj_a1b2c3"
        ],
        "role": "rol_a1b2c3",
        "state": "open"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
