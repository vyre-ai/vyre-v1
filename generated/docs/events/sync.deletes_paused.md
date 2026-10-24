# sync.deletes_paused

More than the guard allows vanished at the source; sync waits for a person

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | entity at /syncTypeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  syncTypeId: string;
  type: string;
  count: number;
  percent: number;
};
```
