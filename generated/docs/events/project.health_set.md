# project.health_set

A manager set how the project stands, or went back to the automatic reading

| | |
|---|---|
| Module | projects |
| Schema version | 1 |
| Subject | project at /projectId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  projectId: string;
  health?: "on" | "risk" | "off" | "hold" | "done";
  previous?: "on" | "risk" | "off" | "hold" | "done";
  by: string;
};
```
