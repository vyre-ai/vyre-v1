# sync.type_bound

A record type was bound to a remote object

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
  type: string;
  connector: string;
};
```
