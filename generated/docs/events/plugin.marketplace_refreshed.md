# plugin.marketplace_refreshed

A marketplace was fetched again

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
  plugins: number;
  by: string;
};
```
