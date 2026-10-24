# kit.rolled_back

A Kit was rolled back in one click

| | |
|---|---|
| Module | kits |
| Schema version | 1 |
| Subject | kit at /kitId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  kitId: string;
  to: string;
};
```
