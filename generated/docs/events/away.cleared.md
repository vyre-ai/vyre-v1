# away.cleared

A person is back; what waited is summarised

| | |
|---|---|
| Module | notifications |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  waitedApprovals: number;
  waitedDigest: number;
};
```
