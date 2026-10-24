# source.paused

A source was paused; deliveries are refused with a visible reason

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | entity at /sourceId |
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
};
```
