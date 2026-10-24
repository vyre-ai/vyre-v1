# computer.removed

An agent computer was removed

| | |
|---|---|
| Module | computers |
| Schema version | 1 |
| Subject | computer at /computerId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  computerId: string;
  agentId: string;
};
```
