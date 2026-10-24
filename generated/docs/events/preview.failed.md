# preview.failed

A preview could not be made; the file still opens as a download

| | |
|---|---|
| Module | previews |
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
  versionId: string;
  reason: "unsupported" | "too_large" | "corrupt" | "converter_down" | "timeout";
};
```
