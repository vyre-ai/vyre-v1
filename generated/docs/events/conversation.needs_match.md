# conversation.needs_match

An unsure sender needs a person to pick the record

| | |
|---|---|
| Module | inbox |
| Schema version | 1 |
| Subject | entity at /conversationId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conversationId: string;
  taskId?: string;
};
```
