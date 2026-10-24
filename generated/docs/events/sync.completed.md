# sync.completed

A sync run finished

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | entity at /syncTypeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A sync finishes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  runId: string;
  syncTypeId: string;
  type: string;
  connector: string;
  mode: string;
  pulled: number;
  pushed: number;
  created: number;
  updated: number;
  removed: number;
};
```
