# conflict.proposed

The assistant proposed a choice for a conflict

| | |
|---|---|
| Module | conflicts |
| Schema version | 1 |
| Subject | entity at /conflictId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conflictId: string;
  choice: string;
  protectedField: boolean;
};
```
