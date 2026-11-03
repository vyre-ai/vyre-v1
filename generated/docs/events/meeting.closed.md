# meeting.closed

Every item of a meeting close-out was approved or skipped

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
  made: Array<{
      type: string;
      id: string;
    }>;
};
```
