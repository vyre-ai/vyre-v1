# sessions.deleted

An imported session was removed from Vyre; the original local files and any chat continued from it stay

| | |
|---|---|
| Module | import |
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
};
```
