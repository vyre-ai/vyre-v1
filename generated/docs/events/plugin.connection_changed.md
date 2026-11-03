# plugin.connection_changed

A connection was renamed, turned off or on, switched to sign-in, or shared with other people

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
