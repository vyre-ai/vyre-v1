# meetings.closeout.share

Share a meeting and its close-out with a project or channel (everyone who can read it sees it in their Meetings tab), or stop sharing

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
| HTTP | POST /v1/meetings/closeout/share |
| MCP tool | meetings_closeout_share (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
  projectId?: string;
  channelId?: string;
  on: boolean;
};
```

## Output

```ts
type Out = {
  meetingId: string;
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
    "channelId": "chn_a1b2c3",
    "meetingId": "rec_a1b2c3",
    "on": true,
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "meetingId": "rec_a1b2c3"
  }
}
```
