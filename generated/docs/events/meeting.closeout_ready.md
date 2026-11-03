# meeting.closeout_ready

The close-out package of a meeting is ready to approve

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
  items: number;
};
```
