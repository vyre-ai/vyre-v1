# computers.recording.delete

Delete a recording

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | yes |
| HTTP | POST /v1/computers/recording/delete |
| MCP tool | computers_recording_delete (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordingId: string;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "recordingId": "rcd_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
