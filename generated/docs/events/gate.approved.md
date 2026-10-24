# gate.approved

A gated act was approved and released

| | |
|---|---|
| Module | gate |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  holdId: string;
  act: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
  taskId: string;
  by: string;
  forPerson?: string;
};
```
