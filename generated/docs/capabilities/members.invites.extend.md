# members.invites.extend

Give an open invite a new expiry

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | members.invite |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/members/invites/extend |
| MCP tool | members_invites_extend (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  inviteId: string;
  expiresInDays: number;
};
```

## Output

```ts
type Out = {
  invite: {
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
  };
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
    "expiresInDays": 1,
    "inviteId": "inv_a1b2c3"
  },
  "output": {
    "invite": {
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
  }
}
```
