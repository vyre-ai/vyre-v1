# plugin.marketplace_added

A marketplace was added

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /marketplaceId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  marketplaceId: string;
  name: string;
  source: string;
  by: string;
};
```
