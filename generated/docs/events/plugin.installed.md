# plugin.installed

A plugin was installed

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /pluginId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  pluginId: string;
  name: string;
  marketplace: string;
  scope: "space" | "agent";
  agentId?: string;
  by: string;
};
```
