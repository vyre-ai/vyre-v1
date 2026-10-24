# spaces.get

The Space profile (regen proof): name, legal name, logo, address, hosting, defaults, kind

| | |
|---|---|
| Module | spaces |
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
| HTTP | POST /v1/spaces/get |
| MCP tool | spaces_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
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
