# plugin.connection_removed

An MCP connection was removed

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /connectionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  connectionId: string;
  name: string;
  by: string;
};
```
