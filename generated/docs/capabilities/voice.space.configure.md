# voice.space.configure

Turn Talk for everyone on or off, and keep the key. An agent's change stops at the Gate for someone who may approve it

| | |
|---|---|
| Module | voice |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | approve when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/voice/space/configure |
| MCP tool | voice_space_configure (meta, deferred) |
| CLI | none |
| Emits | voice.space_changed |

## Input

```ts
type In = {
  on: boolean;
};
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
  "input": {
    "on": true
  },
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
