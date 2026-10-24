# access_review.opened

A quarterly access review opened and made its tasks

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /reviewId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  reviewId: string;
  items: number;
};
```
