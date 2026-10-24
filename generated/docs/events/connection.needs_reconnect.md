# connection.needs_reconnect

The provider rejected the sign-in; the owner must reconnect

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | connection at /connectionId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  connectionId: string;
  connector: string;
};
```
