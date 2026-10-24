# project.cascade_proposed

The plan proposed moving later tasks after a slip

| | |
|---|---|
| Module | projects |
| Schema version | 1 |
| Subject | project at /projectId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  projectId: string;
  proposalId: string;
  moves: number;
  by: string;
};
```
