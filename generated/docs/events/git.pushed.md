# git.pushed

The folder pushed to its remote

| | |
|---|---|
| Module | git |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | A push happens |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  folderId: string;
  branch: string;
  remote: string;
  sha: string;
  protectedBranch: boolean;
};
```
