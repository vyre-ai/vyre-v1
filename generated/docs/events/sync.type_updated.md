# sync.type_updated

Mapping, direction or rules of a synced type changed

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | entity at /syncTypeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  syncTypeId: string;
  fields: Array<string>;
};
```
