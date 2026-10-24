# device.registered

A device signed in for the first time

| | |
|---|---|
| Module | devices |
| Schema version | 1 |
| Subject | entity at /deviceId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  deviceId: string;
  person: string;
  class: "desktop" | "phone" | "web" | "extension" | "daemon";
  name: string;
};
```
