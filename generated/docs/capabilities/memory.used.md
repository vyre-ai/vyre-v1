# memory.used

What recall put in front of the agent for one message: the facts and the exact quotes, each read again now under your access (a fact since deleted, or a chat closed to you, is not shown); for the "Used N memories" line and "Show what the agent knew here"

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/used |
| MCP tool | memory_used (memory) |
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
  messageId: string;
  at?: number;
  facts: Array<{
      factId: string;
      layer: "person" | "agent" | "project" | "space";
      ownerRef: string;
      agentId?: string;
      noteId: string;
      text: string;
      validFrom: number;
      validTo: number;
      learnedAt: number;
      closedAt: number;
      sourceKind: "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
      sourceRef: string;
      sourceLink: string;
      status: "proposed" | "current" | "closed" | "removed";
      lowRisk: boolean;
      sourceTitle?: string;
    }>;
  quotes: Array<{
      ref: string;
      source: "message" | "step";
      text: string;
      truncated?: boolean;
      author: {
        kind: "person" | "agent" | "actor" | "service";
        id: string;
        name?: string;
      };
      role: string;
      at: number;
      threadId: string;
      threadTitle?: string;
      link: string;
      score: number;
    }>;
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
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "at": 1760000000000,
    "facts": [
      {
        "agentId": "agt_a1b2c3",
        "closedAt": 1760000000000,
        "factId": "fct_a1b2c3",
        "layer": "person",
        "learnedAt": 1760000000000,
        "lowRisk": true,
        "noteId": "not_a1b2c3",
        "ownerRef": "agt_a1b2c3",
        "sourceKind": "chat",
        "sourceLink": "example",
        "sourceRef": "example",
        "sourceTitle": "example",
        "status": "proposed",
        "text": "example",
        "validFrom": 1760000000000,
        "validTo": 1760000000000
      }
    ],
    "messageId": "msg_a1b2c3",
    "quotes": [
      {
        "at": 1760000000000,
        "author": {
          "id": "example",
          "kind": "person",
          "name": "example"
        },
        "link": "vyre://thread/thr_a1b2c3?m=msg_a1b2c3",
        "ref": "msg_a1b2c3",
        "role": "example",
        "score": 1,
        "source": "message",
        "text": "example",
        "threadId": "thr_a1b2c3",
        "threadTitle": "example",
        "truncated": true
      }
    ]
  }
}
```
