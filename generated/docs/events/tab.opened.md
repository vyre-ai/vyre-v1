# tab.opened

An agent opened a side tab for a person (delivered live to that person devices)

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  threadId: string;
  personId: string;
  targetType: string;
  targetId: string;
  agentId: string;
};
```
