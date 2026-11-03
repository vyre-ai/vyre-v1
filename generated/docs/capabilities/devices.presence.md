# devices.presence

Who is around: for each person, online (a device seen in the last five minutes), away (they set themselves away) or offline, with when they were last seen. Says when, never where

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
| Team Space only | yes |
| HTTP | POST /v1/devices/presence |
| MCP tool | devices_presence (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  people?: Array<string>;
};
```

## Output

```ts
type Out = {
  people: Array<{
      personId: string;
      state: "online" | "away" | "offline";
      lastSeenAt?: number;
      awayUntil?: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "people": [
      "usr_a1b2c3"
    ]
  },
  "output": {
    "people": [
      {
        "awayUntil": 1760000000000,
        "lastSeenAt": 1760000000000,
        "personId": "usr_a1b2c3",
        "state": "online"
      }
    ]
  }
}
```
