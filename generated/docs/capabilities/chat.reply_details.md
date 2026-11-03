# chat.reply_details

How one agent reply was made, for its hover card and Details tab: its turn, what the agent knew, and its own steps when no turn was kept. Account, cost and tool arguments are for the asker and AI-spend managers only

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/reply_details |
| MCP tool | chat_reply_details (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
};
```

## Output

```ts
type Out = {
  details: {
    messageId: string;
    threadId: string;
    agentId: string;
    at: number;
    turn?: {
      turnId: string;
      traceId: string;
      agentId: string;
      asker: string;
      model: string;
      effort?: string;
      engine: string;
      provider?: string;
      accountKind?: "api_key" | "subscription";
      shared?: boolean;
      accountRef?: string;
      state: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
      paid?: string;
      ranOn: Array<{
          kind: string;
          name: string;
        }>;
      timing: {
        queuedAt?: number;
        startedAt: number;
        firstTokenAt?: number;
        endedAt?: number;
      };
      tokens: {
        in: number;
        out: number;
        context?: number;
        cacheRead?: number;
        cacheWrite?: number;
        reasoning?: number;
      };
      cost?: {
        source: "subscription" | "reported" | "catalog" | "estimate" | "unknown";
        micros?: number;
        lines?: Array<{
            kind: "input" | "output" | "cache_read" | "cache_write";
            tokens: number;
            perMillion: number;
            micros: number;
          }>;
        priceAsOf?: string;
        missing?: Array<string>;
      };
      tools: Array<{
          name: string;
          args?: string;
          ok?: boolean;
          durationMs?: number;
          heldTaskId?: string;
        }>;
      files: {
        read: Array<string>;
        written: Array<string>;
      };
      skills: Array<string>;
      switches: Array<{
          at: number;
          why: string;
          sameAccount: boolean;
          from?: string;
          to?: string;
        }>;
      error?: {
        code: string;
        message: string;
      };
      private: boolean;
      partial: boolean;
    };
    memory?: {
      facts: Array<{
          factId: string;
          text: string;
          sourceTitle?: string;
        }>;
      quotes: Array<{
          ref: string;
          text: string;
          threadTitle?: string;
          at: number;
        }>;
    };
    steps: Array<{
        name: string;
        ok?: boolean;
        secs?: number;
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
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "details": {
      "agentId": "agt_a1b2c3",
      "at": 1760000000000,
      "memory": {
        "facts": [
          {
            "factId": "example",
            "sourceTitle": "example",
            "text": "example"
          }
        ],
        "quotes": [
          {
            "at": 1760000000000,
            "ref": "example",
            "text": "example",
            "threadTitle": "example"
          }
        ]
      },
      "messageId": "msg_a1b2c3",
      "steps": [
        {
          "name": "example",
          "ok": true,
          "secs": 1
        }
      ],
      "threadId": "thr_a1b2c3",
      "turn": {
        "accountKind": "api_key",
        "accountRef": "example",
        "agentId": "agt_a1b2c3",
        "asker": "example",
        "cost": {
          "lines": [
            {
              "kind": "input",
              "micros": 1,
              "perMillion": 1,
              "tokens": 1
            }
          ],
          "micros": 1,
          "missing": [
            "example"
          ],
          "priceAsOf": "2026-10-06",
          "source": "subscription"
        },
        "effort": "example",
        "engine": "example",
        "error": {
          "code": "example",
          "message": "example"
        },
        "files": {
          "read": [
            "example"
          ],
          "written": [
            "example"
          ]
        },
        "model": "example",
        "paid": "example",
        "partial": true,
        "private": true,
        "provider": "example",
        "ranOn": [
          {
            "kind": "example",
            "name": "example"
          }
        ],
        "shared": true,
        "skills": [
          "example"
        ],
        "state": "queued",
        "switches": [
          {
            "at": 1760000000000,
            "from": "example",
            "sameAccount": true,
            "to": "example",
            "why": "example"
          }
        ],
        "timing": {
          "endedAt": 1760000000000,
          "firstTokenAt": 1760000000000,
          "queuedAt": 1760000000000,
          "startedAt": 1760000000000
        },
        "tokens": {
          "cacheRead": 1,
          "cacheWrite": 1,
          "context": 1,
          "in": 1,
          "out": 1,
          "reasoning": 1
        },
        "tools": [
          {
            "args": "example",
            "durationMs": 1,
            "heldTaskId": "tsk_a1b2c3",
            "name": "example",
            "ok": true
          }
        ],
        "traceId": "0123456789abcdef0123456789abcdef",
        "turnId": "trn_a1b2c3"
      }
    }
  }
}
```
