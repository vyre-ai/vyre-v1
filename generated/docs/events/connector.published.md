# connector.published

A connector version went live after a fresh passing test run

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | connector at /key |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  key: string;
  version: string;
  tests: number;
};
```
