# connector.publish_failed

Publish was refused because tests failed; the last good version stays live

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | connector at /key |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  key: string;
  failed: number;
};
```
