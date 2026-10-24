# computers.recording.process

Say what the agent should do with a recording: make a skill, learn a routine, work out the app backend calls (site recipe note), learn this workflow

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/recording/process |
| MCP tool | computers_recording_process (computer) |
| CLI | none |
| Emits | computer.recording_processed |

## Input

```ts
type In = {
  recordingId: string;
  intents: Array<"make_skill" | "learn_routine" | "work_out_backend_calls" | "learn_workflow">;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
  runId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "intents": [
      "make_skill"
    ],
    "recordingId": "rcd_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3",
    "taskId": "tsk_a1b2c3"
  }
}
```
