# meeting.ended

A meeting ended

| | |
|---|---|
| Module | meetings |
| Schema version | 1 |
| Subject | record at /meetingId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | A meeting ends |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  meetingId: string;
  provider: "zoom" | "meet" | "teams" | "none";
  attendeeIds: Array<string>;
};
```
