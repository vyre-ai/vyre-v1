# devices.sessions.list

Sessions of a person (own, or any with access.manage)

| | |
|---|---|
| Module | devices |
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
| HTTP | POST /v1/devices/sessions/list |
| MCP tool | devices_sessions_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  sessions: Array<{
      id: string;
      principal: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      };
      deviceId?: string;
      kind: "device" | "agent_run";
      startedAt: number;
      lastSeenAt: number;
      location?: string;
      current?: boolean;
    }>;
  next?: string;
  total?: number;
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
  "input": {
    "cursor": "example",
    "limit": 1,
    "person": "usr_a1b2c3"
  },
  "output": {
    "next": "example",
    "sessions": [
      {
        "current": true,
        "deviceId": "dev_a1b2c3",
        "id": "ses_a1b2c3",
        "kind": "device",
        "lastSeenAt": 1760000000000,
        "location": "example",
        "principal": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "startedAt": 1760000000000
      }
    ],
    "total": 1
  }
}
```
