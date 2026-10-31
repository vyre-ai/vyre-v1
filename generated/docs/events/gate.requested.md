# gate.requested

A gated act stopped and became an Approve task with the exact preview

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
  act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
  capName: string;
  taskId: string;
  principal: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  actingFor?: string;
  runId?: string;
  expiresAt: number;
};
```
