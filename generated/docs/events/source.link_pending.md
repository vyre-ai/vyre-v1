# source.link_pending

The linking step found only unsure matches and sent them to Needs you

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | entity at /matchId |
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
  matchId: string;
  candidates: number;
};
```
