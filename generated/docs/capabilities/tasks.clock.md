# tasks.clock

What the clock moves, once a minute: the day a task is due begins for its holder, a due time passes, a snooze ends, a step sat with someone too long

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/clock |
| MCP tool | none |
| CLI | none |
| Emits | task.due, task.snoozed, task.nudged |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  due: number;
  woke: number;
  nudged: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "due": 1,
    "nudged": 1,
    "woke": 1
  }
}
```
