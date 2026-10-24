# site.build_failed

A build failed

| | |
|---|---|
| Module | sites |
| Schema version | 1 |
| Subject | site at /siteId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | run.failed |
| Retention | default |

## Payload

```ts
type Payload = {
  siteId: string;
  deploymentId: string;
  reason: string;
};
```
