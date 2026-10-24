# members.invites.create

Invite a person: role, groups, the agents, projects and channels they start in, expiry; returns the link (address, one-time code, Space key fingerprint)

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/invites/create |
| MCP tool | members_invites_create (meta) |
| CLI | none |
| Emits | member.invited |

## Input

```ts
type In = {
  role: string;
  email?: string;
  groups?: Array<string>;
  agents?: Array<string>;
  projects?: Array<string>;
  channels?: Array<string>;
  expiresInDays?: number;
  aiKeyHandle?: string;
  idempotencyKey: string;
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
  link: string;
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
    "agents": [
      "agt_a1b2c3"
    ],
    "aiKeyHandle": "#Dana_Lawmatics",
    "channels": [
      "chn_a1b2c3"
    ],
    "email": "maya@example.com",
    "expiresInDays": 1,
    "groups": [
      "grp_a1b2c3"
    ],
    "idempotencyKey": "idem_1",
    "projects": [
      "prj_a1b2c3"
    ],
    "role": "rol_a1b2c3"
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
    },
    "link": "https://team.example.com/join/K7P2-9QXA"
  }
}
```
