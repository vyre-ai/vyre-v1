# spaces.update

Change the Space name, legal name, logo or defaults

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/spaces/update |
| MCP tool | spaces_update (meta) |
| CLI | none |
| Emits | space.updated |

## Input

```ts
type In = {
  name?: string;
  legalName?: string;
  logoFileId: string | null;
  defaults?: Record<string, unknown>;
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
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "defaults": {},
    "legalName": "example",
    "logoFileId": "fil_a1b2c3",
    "name": "example"
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
