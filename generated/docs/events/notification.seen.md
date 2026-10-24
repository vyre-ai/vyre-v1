# notification.seen

Notifications were marked seen

| | |
|---|---|
| Module | notifications |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  notificationIds: Array<string>;
  place?: "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console";
};
```
