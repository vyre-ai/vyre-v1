# token.registered

An outside agent registered with a one-time token and became an outside actor

| | |
|---|---|
| Module | mcp |
| Schema version | 1 |
| Subject | entity at /actorId |
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
  actorId: string;
  name: string;
  scopes: {
    read: boolean;
    post: boolean;
    readChangesets: boolean;
    writeBranch: boolean;
  };
};
```
