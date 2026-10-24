# computers.record_start

Record while you take over: every click and key with the element, each page, network traffic with secrets masked, and video

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.take_over |
| Grant level | use |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | yes |
| HTTP | POST /v1/computers/record_start |
| MCP tool | computers_record_start (computer) |
| CLI | none |
| Emits | computer.recording_started |

## Input

```ts
type In = {
  computerId: string;
};
```

## Output

```ts
type Out = {
  recordingId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3"
  },
  "output": {
    "recordingId": "rcd_a1b2c3"
  }
}
```
