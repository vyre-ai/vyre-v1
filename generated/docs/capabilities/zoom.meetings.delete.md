# zoom.meetings.delete

Delete a Zoom meeting

| | |
|---|---|
| Module | zoom |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | delete |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/zoom/meetings/delete |
| MCP tool | zoom_meetings_delete (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "meetingId": "example"
  },
  "output": {
    "deleted": true
  }
}
```
