# access_review.closed

An access review closed

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
| Retention | audit |

## Payload

```ts
type Payload = {
  reviewId: string;
  kept: number;
  removed: number;
};
```
