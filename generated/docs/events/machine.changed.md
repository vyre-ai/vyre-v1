# machine.changed

A machine was renamed, limited, drained or had an agent pinned or unpinned

| | |
|---|---|
| Module | machines |
| Schema version | 1 |
| Subject | entity at /machineId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  machineId: string;
  what: Array<"nickname" | "limits" | "drain" | "pins">;
};
```
