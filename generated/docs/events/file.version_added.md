# file.version_added

A file got a new version

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A file changes |
| Notification | none |
| Retention | file_versions |

## Payload

```ts
type Payload = {
  fileId: string;
  versionId: string;
  n: number;
  by: string;
  reason?: string;
};
```
