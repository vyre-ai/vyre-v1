# tasks.changes

What the Space did to my tasks since a time (put away because they passed, their chat closed, nobody answered), each with its reason; and how many new ones wait on me. Built from the log

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/changes |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  since: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
      taskId: string;
      title: string;
      code: "hand" | "asked" | "passed" | "gone" | "quiet";
      why: string;
      at: number;
      by: string;
    }>;
  counts: Record<string, number>;
  fresh: number;
  since: number;
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
  "input": {
    "since": 1760000000000
  },
  "output": {
    "counts": {},
    "fresh": 1,
    "items": [
      {
        "at": 1760000000000,
        "by": "example",
        "code": "hand",
        "taskId": "tsk_a1b2c3",
        "title": "example",
        "why": "example"
      }
    ],
    "since": 1760000000000
  }
}
```
