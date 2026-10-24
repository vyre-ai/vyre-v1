# search.reindexed

The search index was rebuilt

| | |
|---|---|
| Module | search |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  entity?: string;
  documents: number;
  runId: string;
};
```
