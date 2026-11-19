# project.folder_unfollowed

A files folder could not follow its record; the host narrows it and tells the owner

| | |
|---|---|
| Module | projects |
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
  recordId: string;
  by: string;
  why: string;
};
```
