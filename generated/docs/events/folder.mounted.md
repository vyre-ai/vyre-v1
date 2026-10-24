# folder.mounted

A drive, library, local folder or repository was mounted as a folder

| | |
|---|---|
| Module | mounts |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A folder is mounted |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  mountId: string;
  folderId: string;
  kind: "google_drive" | "sharepoint" | "onedrive" | "local" | "github";
  by: string;
};
```
