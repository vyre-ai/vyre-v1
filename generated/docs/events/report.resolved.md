# report.resolved

The Vyre team closed the issue; the reporter hears back in the Inbox

| | |
|---|---|
| Module | reports-client |
| Schema version | 1 |
| Subject | entity at /reportId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | problem.report |
| Retention | default |

## Payload

```ts
type Payload = {
  reportId: string;
  issueNumber: number;
  fixedIn?: string;
};
```
