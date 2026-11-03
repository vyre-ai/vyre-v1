# devices.touch

Last seen of one of my devices (the current one when none is named): the app calls it on activity, at most once a minute; coming back after four hours or more writes the While you were away digest

| | |
|---|---|
| Module | devices |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/devices/touch |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  deviceId?: string;
  location?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  lastSeenAt?: number;
  back?: boolean;
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
    "deviceId": "dev_a1b2c3",
    "location": "example"
  },
  "output": {
    "back": true,
    "lastSeenAt": 1760000000000,
    "ok": true
  }
}
```
