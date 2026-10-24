# token.issued

A one-time registration token was issued for an outside agent (never the token itself)

| | |
|---|---|
| Module | mcp |
| Schema version | 1 |
| Subject | entity at /tokenId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  tokenId: string;
  name: string;
  kind: string;
  channelId?: string;
  by: string;
  expiresAt: number;
};
```
