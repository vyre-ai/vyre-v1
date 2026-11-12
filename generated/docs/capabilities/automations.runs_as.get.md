# automations.runs_as.get

Whose yes a Space automation's agent work runs on, and whether that person may still give it to this agent; for one Run, its trigger

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/runs_as/get |
| MCP tool | automations_runs_as_get (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
  agentId?: string;
  runId?: string;
};
```

## Output

```ts
type Out = {
  kind: "personal" | "space";
  runsAs?: string;
  name?: string;
  trigger?: string;
  ok: boolean;
  reason?: "nobody" | "not_active" | "cannot_ask" | "assistant";
  line?: string;
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
    "agentId": "agt_a1b2c3",
    "automationId": "aut_a1b2c3",
    "runId": "run_a1b2c3"
  },
  "output": {
    "kind": "personal",
    "line": "example",
    "name": "example",
    "ok": true,
    "reason": "nobody",
    "runsAs": "example",
    "trigger": "example"
  }
}
```
