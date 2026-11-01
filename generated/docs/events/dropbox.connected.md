# dropbox.connected

A Dropbox account was connected

| | |
|---|---|
| Module | dropbox |
| Schema version | 1 |
| Subject | entity at /connectionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  connectionId: string;
  accountId: string;
  ownerKind: "person" | "space";
  email?: string;
};
```
