# plugin.connection_added

An MCP server was connected

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
  scope: "space" | "agent";
  agentId?: string;
  by: string;
};
```
