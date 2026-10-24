# notification.push_registered

A device registered a push token (token value not in the event)

| | |
|---|---|
| Module | notifications |
| Schema version | 1 |
| Subject | entity at /device |
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
  device: string;
  platform: "ios" | "android" | "mac" | "windows" | "web";
};
```
