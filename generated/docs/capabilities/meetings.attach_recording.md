# meetings.attach_recording

Download a provider recording into the meeting folder, store the transcript text and show them in the conversation

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/attach_recording |
| MCP tool | meetings_attach_recording (inbox) |
| CLI | none |
| Emits | meeting.recording_attached, meeting.transcript_ready |

## Input

```ts
type In = {
  meetingId: string;
  source: "zoom" | "meet" | "teams" | "upload";
  providerRef?: string;
  fileId?: string;
  transcriptText?: string;
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
- permission.role_lacks_permission
- provider.auth_failed
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "meetingId": "rec_a1b2c3",
    "providerRef": "example",
    "source": "zoom",
    "transcriptText": "example"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
