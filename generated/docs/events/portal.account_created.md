# portal.account_created

A site end-user account was created (not a Space member)

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
