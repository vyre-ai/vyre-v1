# notes.linked

A task or record was made from a note

| | |
|---|---|
| Module | notes |
| Schema version | 1 |
| Subject | entity at /noteId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  noteId: string;
  owner: string;
  kind: "task" | "record";
  id: string;
};
```
