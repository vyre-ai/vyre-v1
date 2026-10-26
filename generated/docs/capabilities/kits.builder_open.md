# kits.builder_open

Open the Kit builder chat with an agent (preview before publish)

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.publish |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/builder_open |
| MCP tool | kits_builder_open (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId?: string;
  brief?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  threadId: string;
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
    "brief": "example",
    "idempotencyKey": "idem_1",
    "kitId": "kit_a1b2c3"
  },
  "output": {
    "threadId": "thr_a1b2c3"
  }
}
```
