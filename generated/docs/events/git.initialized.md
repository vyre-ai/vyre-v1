# git.initialized

A folder became a git repository

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
};
```
