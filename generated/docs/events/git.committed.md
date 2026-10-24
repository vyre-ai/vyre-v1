# git.committed

A commit was made (authored by the first editor, person or agent)

| | |
|---|---|
| Module | git |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A commit is made |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  folderId: string;
  sha: string;
  branch: string;
  by: string;
  files: number;
  message: string;
};
```
