# site.domain_changed

A site domain was set or removed

| | |
|---|---|
| Module | sites |
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
  siteId: string;
  domain: string;
};
```
