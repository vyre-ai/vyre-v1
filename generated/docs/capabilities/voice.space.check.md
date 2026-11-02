# voice.space.check

Check the Space key with the provider now

| | |
|---|---|
| Module | voice |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/voice/space/check |
| MCP tool | voice_space_check (meta, deferred) |
| CLI | none |
| Emits | voice.space_checked |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  set: boolean;
  on: boolean;
  provider?: string;
  itemId?: string;
  setBy?: string;
  checkedAt?: number;
  state?: "ok" | "failing";
  peopleOwnKey?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "checkedAt": 1760000000000,
    "itemId": "vit_a1b2c3",
    "on": true,
    "peopleOwnKey": 1,
    "provider": "deepgram",
    "set": true,
    "setBy": "usr_a1b2c3",
    "state": "ok"
  }
}
```
