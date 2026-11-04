# ci.blocked

CI cannot start machines until something is fixed (for example the runner download cannot be verified); the admins' Inbox line, once a day

| | |
|---|---|
| Module | ci |
| Schema version | 1 |
| Subject | entity at /day |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | ci.paused |
| Retention | default |

## Payload

```ts
type Payload = {
  title: string;
  why: "runner_unverified";
  day: string;
};
```
