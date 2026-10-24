# console.change_applied

A person applied a proposed change; the audit row reads on behalf of

| | |
|---|---|
| Module | console-assistant |
| Schema version | 1 |
| Subject | entity at /diffId |
| Visibility | space |
| Label | internal |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  diffId: string;
  kind: string;
  by: string;
  onBehalfOf?: string;
};
```
