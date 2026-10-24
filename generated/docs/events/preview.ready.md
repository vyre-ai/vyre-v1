# preview.ready

Thumbnails, page images or text were made for a file version

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
  kinds: Array<"thumbnail" | "pages" | "text">;
  pages?: number;
};
```
