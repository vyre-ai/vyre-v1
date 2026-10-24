# github.check_completed

A check run finished

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /repo |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A CI check finishes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  repo: string;
  sha: string;
  name: string;
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required";
  number?: number;
};
```
