# conversation.matched

A sender was linked to a contact or company record

| | |
|---|---|
| Module | inbox |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A sender is matched to a record |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conversationId: string;
  recordId: string;
  by: "rule" | "person" | "agent";
  undoable: boolean;
};
```
