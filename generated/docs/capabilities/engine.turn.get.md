# engine.turn.get

What happened: steps, durations, machine, model, key used and denials of one turn

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/turn/get |
| MCP tool | engine_turn_get (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  turnId: string;
};
```

## Output

```ts
type Out = {
  what: {
    turn: {
      turnId: string;
      threadId: string;
      agentId: string;
      asker: string;
      accountRef?: string;
      engine: string;
      model: string;
      state: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
      traceId: string;
      runId?: string;
      startedAt: number;
      endedAt?: number;
      tokensIn: number;
      tokensOut: number;
      costMicros: number;
      error?: {
        code: string;
        message: string;
        next: Array<{
            kind: string;
            label: string;
          }>;
        traceId: string;
      };
    };
    machine: "host" | "device";
    keyUsed?: string;
    steps: Array<{
        idx: number;
        kind: string;
        title: string;
        durationMs: number;
        ok: boolean;
      }>;
    denials: Array<{
        cap: string;
        reason: string;
      }>;
    fallbacks: Array<{
        kind: string;
        to: string;
        at: number;
      }>;
  };
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
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "what": {
      "denials": [
        {
          "cap": "example",
          "reason": "example"
        }
      ],
      "fallbacks": [
        {
          "at": 1760000000000,
          "kind": "example",
          "to": "example"
        }
      ],
      "keyUsed": "example",
      "machine": "host",
      "steps": [
        {
          "durationMs": 1,
          "idx": 1,
          "kind": "example",
          "ok": true,
          "title": "example"
        }
      ],
      "turn": {
        "accountRef": "#Team_Anthropic_Key",
        "agentId": "agt_a1b2c3",
        "asker": "example",
        "costMicros": 1,
        "endedAt": 1760000000000,
        "engine": "example",
        "error": {
          "code": "example",
          "message": "example",
          "next": [
            {
              "kind": "example",
              "label": "example"
            }
          ],
          "traceId": "0123456789abcdef0123456789abcdef"
        },
        "model": "example",
        "runId": "run_a1b2c3",
        "startedAt": 1760000000000,
        "state": "queued",
        "threadId": "thr_a1b2c3",
        "tokensIn": 1,
        "tokensOut": 1,
        "traceId": "0123456789abcdef0123456789abcdef",
        "turnId": "trn_a1b2c3"
      }
    }
  }
}
```
