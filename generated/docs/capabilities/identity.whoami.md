# identity.whoami

Who the caller is here: person, roles, clearance, device, epoch

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/identity/whoami |
| MCP tool | identity_whoami (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  principal: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  name: string;
  roles: Array<string>;
  groups: Array<string>;
  deviceId?: string;
  epoch: number;
  spaceId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "deviceId": "dev_a1b2c3",
    "epoch": 1,
    "groups": [
      "grp_a1b2c3"
    ],
    "name": "example",
    "principal": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "roles": [
      "rol_a1b2c3"
    ],
    "spaceId": "spc_a1b2c3"
  }
}
```
