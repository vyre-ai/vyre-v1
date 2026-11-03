# notes.updated

A note was changed: text, colour, pin, labels, image or link

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
  by: string;
};
```
