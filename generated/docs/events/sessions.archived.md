# sessions.archived

An imported session moved to the owner Archived list, or back out of it

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
  archived: boolean;
};
```
