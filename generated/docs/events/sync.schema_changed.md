# sync.schema_changed

The remote schema changed and needs review

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
  changes: number;
};
```
