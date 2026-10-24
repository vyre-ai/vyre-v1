# report.submitted

A person reported a problem; admins get a Review task

| | |
|---|---|
| Module | reports-client |
| Schema version | 1 |
| Subject | entity at /reportId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A problem is reported |
| Notification | problem.report |
| Retention | default |

## Payload

```ts
type Payload = {
  reportId: string;
  by: string;
  traceIds: Array<string>;
};
```
