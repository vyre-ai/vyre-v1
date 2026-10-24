# meeting.transcript_ready

The transcript text was stored on the meeting

| | |
|---|---|
| Module | meetings |
| Schema version | 1 |
| Subject | record at /meetingId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A meeting transcript is ready |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  meetingId: string;
  source: "zoom" | "meet" | "teams" | "upload";
};
```
