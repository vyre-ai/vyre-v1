# token.revealed

A one-time token was revealed or copied

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
| Retention | audit |

## Payload

```ts
type Payload = {
  tokenId: string;
  action: string;
  by: string;
};
```
