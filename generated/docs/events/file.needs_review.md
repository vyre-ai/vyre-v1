# file.needs_review

A new version left redactions it could not place: agents wait for a review

| | |
|---|---|
| Module | files |
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
  fileId: string;
  version: number;
  unplaced: number;
};
```
