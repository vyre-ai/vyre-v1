# hook.admin_asked

Someone asked the Space admins about a hook that stopped something

| | |
|---|---|
| Module | hooks |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | hook.asked |
| Retention | default |

## Payload

```ts
type Payload = {
  hookId: string;
  threadId: string;
  line: string;
  reason?: string;
  by: string;
  note?: string;
};
```
