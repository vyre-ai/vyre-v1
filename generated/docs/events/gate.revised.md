# gate.revised

A held message was edited before it was sent: the approval is bound to the new words

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
  act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "install" | "approve";
  taskId: string;
  by: string;
  was: string;
  now: string;
};
```
