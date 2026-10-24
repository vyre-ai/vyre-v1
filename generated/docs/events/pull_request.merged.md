# pull_request.merged

A pull request was merged

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /repo |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  repo: string;
  number: number;
  recordId?: string;
};
```
