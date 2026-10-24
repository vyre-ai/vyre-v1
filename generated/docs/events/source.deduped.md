# source.deduped

A delivery repeated a provider id already seen and was dropped

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | entity at /deliveryId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  sourceId: string;
  deliveryId: string;
  providerId: string;
};
```
