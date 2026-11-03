# member.join_stuck

A join step (a group, a channel, a project, an agent, the first channel, their mail and calendar) failed three times; it is still tried every two minutes and shows in Console Overview

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  personId: string;
  step: string;
  error: string;
  tries: number;
};
```
