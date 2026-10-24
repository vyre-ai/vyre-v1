# google.push_received

A verified Google push notice arrived (Gmail, Calendar, Drive or Meet)

| | |
|---|---|
| Module | google |
| Schema version | 1 |
| Subject | connector at /connector |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  connector: "google";
  kind: "gmail" | "calendar" | "drive" | "meet";
  messageId: string;
  mailbox?: string;
  historyId?: string;
  channelId?: string;
  resourceState?: string;
  resourceId?: string;
};
```
