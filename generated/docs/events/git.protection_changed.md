# git.protection_changed

The protected branches of a folder changed

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
  branches: Array<string>;
};
```
