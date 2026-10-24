# source.received

An outside event arrived on /hooks/<source>, was verified and accepted

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | entity at /deliveryId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A source delivers an event |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  sourceId: string;
  deliveryId: string;
  source: string;
  providerId?: string;
  type?: string;
  recordIds: Array<string>;
};
```
