# google.dwd_configured

Domain-wide delegation was set up

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
  adminEmail: string;
  mappedMembers: number;
  autoConnect: boolean;
};
```
