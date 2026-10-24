# zoom.recordings.list

List cloud recordings in a time range

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
| HTTP | POST /v1/zoom/recordings/list |
| MCP tool | zoom_recordings_list (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  from: string;
  to: string;
  hostEmail?: string;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  meetings: Array<{
      meetingId: string;
      uuid: string;
      topic: string;
      startTime: number;
      files: Array<{
          id: string;
          fileType: string;
          recordingType?: string;
          fileSize?: number;
          downloadUrl?: string;
          status?: string;
        }>;
    }>;
  nextPageToken?: string;
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
    "from": "example",
    "hostEmail": "maya@example.com",
    "pageToken": "example",
    "to": "example"
  },
  "output": {
    "meetings": [
      {
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
        "meetingId": "example",
        "startTime": 1760000000000,
        "topic": "example",
        "uuid": "example"
      }
    ],
    "nextPageToken": "example"
  }
}
```
