# devices.list

All devices in the Space, by person or class (Console > Sessions and devices)

| | |
|---|---|
| Module | devices |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | access.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/devices/list |
| MCP tool | devices_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person?: string;
  class?: "desktop" | "phone" | "web" | "extension" | "daemon";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  devices: Array<{
      id: string;
      person: string;
      name: string;
      class: "desktop" | "phone" | "web" | "extension" | "daemon";
      epoch: number;
      lastSeenAt?: number;
      location?: string;
      revokedAt?: number;
      current?: boolean;
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
    "class": "desktop",
    "cursor": "example",
    "limit": 1,
    "person": "usr_a1b2c3"
  },
  "output": {
    "devices": [
      {
        "class": "desktop",
        "current": true,
        "epoch": 1,
        "id": "dev_a1b2c3",
        "lastSeenAt": 1760000000000,
        "location": "example",
        "name": "example",
        "person": "usr_a1b2c3",
        "revokedAt": 1760000000000
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
