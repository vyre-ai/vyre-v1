# spaces.timezone.set

Set the Space time zone (an IANA name). Shared places read times in it; each person sees their own beside it. Deadlines keep their moment. An agent needs an admin to approve

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | approve when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/spaces/timezone/set |
| MCP tool | spaces_timezone_set (meta) |
| CLI | none |
| Emits | space.updated |

## Input

```ts
type In = {
  timezone: string;
};
```

## Output

```ts
type Out = {
  space: {
    id: string;
    name: string;
    legalName?: string;
    logoFileId?: string;
    kind: "personal" | "team";
    owner: string;
    fingerprint: string;
    address: {
      mode: "relay" | "own_domain" | "device";
      host?: string;
    };
    hostedOn?: string;
    defaults: Record<string, unknown>;
    createdAt: number;
    timezone?: string;
    deletionAt?: number;
  };
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
    "timezone": "America/Los_Angeles"
  },
  "output": {
    "space": {
      "address": {
        "host": "example",
        "mode": "relay"
      },
      "createdAt": 1760000000000,
      "defaults": {},
      "deletionAt": 1760000000000,
      "fingerprint": "ab12 cd34 ef56 7890",
      "hostedOn": "example",
      "id": "spc_a1b2c3",
      "kind": "personal",
      "legalName": "example",
      "logoFileId": "fil_a1b2c3",
      "name": "example",
      "owner": "usr_a1b2c3",
      "timezone": "America/Los_Angeles"
    }
  }
}
```
