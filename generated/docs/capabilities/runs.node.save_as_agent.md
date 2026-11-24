# runs.node.save_as_agent

Make a finished piece of work into an agent: its brief becomes the instructions, with the same model and the tool limits it began with (the allowed list only for someone who manages its agent). Made as the person who asks; an agent asking needs the person's ok

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | run (/runId) |
| Gate | approve when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/node/save_as_agent |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  name?: string;
  role?: string;
  instructions?: string;
  sharing?: "me" | "everyone";
};
```

## Output

```ts
type Out = {
  agent: unknown;
  runId: string;
  toolsCarried: "kept" | "narrowed" | "default";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.duplicate
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "instructions": "example",
    "name": "example",
    "role": "example",
    "runId": "run_a1b2c3",
    "sharing": "me"
  },
  "output": {
    "agent": {},
    "runId": "run_a1b2c3",
    "toolsCarried": "kept"
  }
}
```
