# spaces.switch_address

Move the Space between the relay and an own domain; devices pin the Space key, so nobody is re-invited

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.network |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/spaces/switch_address |
| MCP tool | spaces_switch_address (engineer) |
| CLI | none |
| Emits | space.address_changed |

## Input

```ts
type In = {
  mode: "relay" | "own_domain";
  host?: string;
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
    "host": "team.example.com",
    "mode": "relay"
  },
  "output": {
    "space": {
      "address": {
        "host": "example",
        "mode": "relay"
      },
      "createdAt": 1760000000000,
      "defaults": {},
      "fingerprint": "ab12 cd34 ef56 7890",
      "hostedOn": "example",
      "id": "spc_a1b2c3",
      "kind": "personal",
      "legalName": "example",
      "logoFileId": "fil_a1b2c3",
      "name": "example",
      "owner": "usr_a1b2c3"
    }
  }
}
```
