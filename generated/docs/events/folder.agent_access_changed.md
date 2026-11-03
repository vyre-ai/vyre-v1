# folder.agent_access_changed

Agent access of a folder changed

| | |
|---|---|
| Module | files |
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
  value: "on" | "redact" | "off";
  own: boolean;
  by: string;
};
```
