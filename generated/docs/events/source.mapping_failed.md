# source.mapping_failed

A verified delivery could not be mapped to a record

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | entity at /deliveryId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  sourceId: string;
  deliveryId: string;
  error: string;
};
```
