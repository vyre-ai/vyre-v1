# portal.signed_in

A site end-user signed in

| | |
|---|---|
| Module | portal |
| Schema version | 1 |
| Subject | site at /siteId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  accountId: string;
  siteId: string;
};
```
