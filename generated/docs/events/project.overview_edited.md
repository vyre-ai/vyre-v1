# project.overview_edited

The Overview page changed (an edit, a save, an applied template or an undo), by a person or an agent

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
  rev: number;
  by: string;
  authorKind: "person" | "agent";
  summary: string;
  undoOf?: number;
};
```
