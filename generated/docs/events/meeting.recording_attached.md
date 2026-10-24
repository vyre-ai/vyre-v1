# meeting.recording_attached

A recording was saved to the meeting folder

| | |
|---|---|
| Module | meetings |
| Schema version | 1 |
| Subject | record at /meetingId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  meetingId: string;
  fileId: string;
  source: "zoom" | "meet" | "teams" | "upload";
};
```
