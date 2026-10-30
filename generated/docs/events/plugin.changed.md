# plugin.changed

A plugin was turned on or off, configured, or used to make an agent

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
  by: string;
};
```
