# gate.approver_moved

The person or role a held act waits on changed (the task was assigned, delegated or escalated): who moved it, from whom, to whom

| | |
|---|---|
| Module | gate |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  holdId: string;
  act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "install" | "approve" | "github_approval";
  taskId: string;
  from?: {
    kind: string;
    id: string;
  };
  to: {
    kind: string;
    id: string;
  };
  by?: string;
  how: "assigned" | "delegated" | "escalated";
};
```
