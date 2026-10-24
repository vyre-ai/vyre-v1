# device.revoked

A device was revoked; it purges its replica on next contact

| | |
|---|---|
| Module | devices |
| Schema version | 1 |
| Subject | entity at /deviceId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  deviceId: string;
  person: string;
  by: string;
};
```
