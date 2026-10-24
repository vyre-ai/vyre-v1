# github.app_created

The GitHub App was created and its key stored

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /slug |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  appId: number;
  slug: string;
};
```
