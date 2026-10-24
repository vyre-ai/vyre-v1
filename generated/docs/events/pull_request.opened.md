# pull_request.opened

A pull request was opened

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /repo |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A pull request is opened |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  repo: string;
  number: number;
  recordId?: string;
  author: string;
};
```
