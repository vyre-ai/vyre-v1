# voice.space.status

Talk for everyone in the Space: whether a key is set, on or off, who set it, when it was last checked and how many people use their own key

| | |
|---|---|
| Module | voice |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/voice/space/status |
| MCP tool | voice_space_status (meta, deferred) |
| CLI | none |
| Emits | none |

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
