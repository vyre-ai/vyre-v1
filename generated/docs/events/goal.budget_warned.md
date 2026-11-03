# goal.budget_warned

A goal used 80 percent of its budget

| | |
|---|---|
| Module | goals |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  goalId: string;
  threadId: string;
  spentMicros: number;
  turns: number;
  budget: {
    spendMicros?: number;
    turns?: number;
  };
};
```
