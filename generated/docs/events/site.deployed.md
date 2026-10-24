# site.deployed

A deployment reached staging or a preview

| | |
|---|---|
| Module | sites |
| Schema version | 1 |
| Subject | site at /siteId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | A site is deployed |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  siteId: string;
  deploymentId: string;
  env: "staging" | "preview";
};
```
