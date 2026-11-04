# projects.set

Set how the project stands (On track, At risk, Off track, On hold or Done) by hand, or null to go back to the reading from the late tasks; audited, and the Overview says who set it

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/set |
| MCP tool | projects_set (records) |
| CLI | none |
| Emits | project.health_set |

## Input

```ts
type In = {
  projectId: string;
  health: ("on" | "risk" | "off" | "hold" | "done") | null;
};
```

## Output

```ts
type Out = {
  health?: "on" | "risk" | "off" | "hold" | "done";
  setBy?: string;
  at?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "health": "on",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "at": 1760000000000,
    "health": "on",
    "setBy": "usr_a1b2c3"
  }
}
```
