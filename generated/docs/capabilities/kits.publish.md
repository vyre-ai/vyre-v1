# kits.publish

Publish a Kit version; blocked on test failure, last good stays live

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.publish |
| Grant level | manage |
| Risk | high |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/kits/publish |
| MCP tool | kits_publish (sites) |
| CLI | none |
| Emits | kit.published, kit.publish_blocked |

## Input

```ts
type In = {
  kitId: string;
  version: string;
  channel: "stable" | "beta";
};
```

## Output

```ts
type Out = {
  published: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "channel": "stable",
    "kitId": "kit_a1b2c3",
    "version": "example"
  },
  "output": {
    "published": true
  }
}
```
