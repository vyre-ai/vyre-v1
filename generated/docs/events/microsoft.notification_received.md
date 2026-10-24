# microsoft.notification_received

A verified Graph change notification arrived

| | |
|---|---|
| Module | microsoft |
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
  connector: "microsoft";
  notificationId: string;
  subscriptionId: string;
  resource: string;
  changeType: "created" | "updated" | "deleted";
  tenantId?: string;
};
```
