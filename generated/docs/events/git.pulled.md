# git.pulled

The folder pulled from its remote

| | |
|---|---|
| Module | git |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  folderId: string;
  branch: string;
  from?: string;
  to: string;
  conflicts: number;
};
```
