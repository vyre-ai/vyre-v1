# repo.pushed

Commits were pushed to a branch

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /repo |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | Code is pushed |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  repo: string;
  number: number;
  branch: string;
  sha: string;
};
```
