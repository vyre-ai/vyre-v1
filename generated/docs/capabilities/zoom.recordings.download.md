# zoom.recordings.download

Download a recording file into Files (a Run; large files)

| | |
|---|---|
| Module | zoom |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/zoom/recordings/download |
| MCP tool | zoom_recordings_download (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
  recordingFileId: string;
  folderId?: string;
};
```

## Output

```ts
type Out = {
  runId: string;
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
    "folderId": "fld_a1b2c3",
    "meetingId": "example",
    "recordingFileId": "example"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
