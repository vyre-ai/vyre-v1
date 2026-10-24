# governance.holds.place

Place a hold on a file, channel, thread, folder or person; it shows On hold and blocks expiry and erasing

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.hold |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/governance/holds/place |
| MCP tool | governance_holds_place (meta) |
| CLI | none |
| Emits | hold.placed |

## Input

```ts
type In = {
  target: {
    kind: "file" | "channel" | "thread" | "folder" | "person";
    id: string;
  };
  reason: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "reason": "example",
    "target": {
      "id": "fil_a1b2c3",
      "kind": "file"
    }
  },
  "output": {
    "ok": true
  }
}
```
