# document.filled

A document was made by filling a template

| | |
|---|---|
| Module | documents |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A document is filled from a template |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId: string;
  templateFileId: string;
  fields: number;
  missing: number;
  recordId?: string;
};
```
