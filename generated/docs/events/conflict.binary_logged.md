# conflict.binary_logged

Two saves of a binary file collided; the other became a labelled version

| | |
|---|---|
| Module | conflicts |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  conflictId: string;
  fileId: string;
  versionId: string;
};
```
