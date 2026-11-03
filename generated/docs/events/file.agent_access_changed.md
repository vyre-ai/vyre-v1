# file.agent_access_changed

Agent access of a file changed

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fileId: string;
  value: "on" | "redact" | "off";
  own: boolean;
  by: string;
};
```
