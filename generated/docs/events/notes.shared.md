# notes.shared

Who reads a note changed

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
  people: Array<string>;
  space: "off" | "view" | "edit";
};
```
