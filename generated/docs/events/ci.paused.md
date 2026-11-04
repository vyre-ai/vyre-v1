# ci.paused

CI paused: this month's cap is reached (once a month; the admins' Inbox line)

| | |
|---|---|
| Module | ci |
| Schema version | 1 |
| Subject | entity at /month |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | ci.paused |
| Retention | default |

## Payload

```ts
type Payload = {
  title: string;
  capUsd: number;
  month: string;
};
```
