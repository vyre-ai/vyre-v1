# zoom.recordings.get

Recording files of one meeting

| | |
|---|---|
| Module | zoom |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/zoom/recordings/get |
| MCP tool | zoom_recordings_get (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
};
```

## Output

```ts
type Out = {
  files: Array<{
      id: string;
      fileType: string;
      recordingType?: string;
      fileSize?: number;
      downloadUrl?: string;
      status?: string;
    }>;
  shareUrl?: string;
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
    "meetingId": "example"
  },
  "output": {
    "files": [
      {
        "downloadUrl": "example",
        "fileSize": 1,
        "fileType": "example",
        "id": "example",
        "recordingType": "example",
        "status": "example"
      }
    ],
    "shareUrl": "example"
  }
}
```
