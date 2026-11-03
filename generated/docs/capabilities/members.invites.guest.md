# members.invites.guest

System: an email invite as a guest of one chat only, called by threads.invite_guest as the person inviting. The role is guest and the one place is the channel; a guest reads (view) or also writes (reply). No Everyone group, no home channel, no files or records

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/invites/guest |
| MCP tool | none |
| CLI | none |
| Emits | member.invited |

## Input

```ts
type In = {
  email: string;
  scope: {
    type: "channel";
    id: string;
  };
  level?: "view" | "reply";
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
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "email": "maya@example.com",
    "idempotencyKey": "idem_1",
    "level": "view",
    "scope": {
      "id": "chn_a1b2c3",
      "type": "channel"
    }
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
    "link": "example"
  }
}
```
