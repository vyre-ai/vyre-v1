# memory.corrections.record

Keep a lesson from a correction made outside the chat's own words: an edit of the agent's draft, a declined or sent-back action, an undo. Called as the person who corrected; kept only when their switch Learn from my corrections is on

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/corrections/record |
| MCP tool | memory_corrections_record (memory) |
| CLI | none |
| Emits | memory.fact_proposed, memory.fact_accepted, memory.learned |

## Input

```ts
type In = {
  agentId: string;
  how: "edit" | "refuse" | "reverse" | "rewrite";
  was?: string;
  now?: string;
  note?: string;
  threadId?: string;
  ref?: string;
};
```

## Output

```ts
type Out = {
  kept: boolean;
  why?: "off" | "forgotten" | "nothing" | "duplicate";
  lesson?: {
    factId: string;
    layer: "person" | "agent" | "project" | "space";
    ownerRef: string;
    agentId?: string;
    noteId?: string;
    text: string;
    validFrom: number;
    validTo?: number;
    learnedAt: number;
    closedAt?: number;
    sourceKind: "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
    sourceRef: string;
    sourceLink?: string;
    status: "proposed" | "current" | "closed" | "removed";
    lowRisk?: boolean;
    trashedAt?: number;
    trashReason?: string;
    archivedAt?: number;
    kind?: string;
    lesson?: {
      how?: "edit" | "refuse" | "reverse" | "rewrite";
      used: number;
      scope: "you" | "proposed" | "space";
    };
    subject?: {
      pageId: string;
      title: string;
      kind: string;
    };
    sourceTitle?: string;
    by?: string;
    byKind?: "person" | "agent" | "upkeep" | "system";
    versions?: number;
  };
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
    "agentId": "agt_a1b2c3",
    "how": "edit",
    "note": "example",
    "now": "example",
    "ref": "example",
    "threadId": "thr_a1b2c3",
    "was": "example"
  },
  "output": {
    "kept": true,
    "lesson": {
      "agentId": "agt_a1b2c3",
      "archivedAt": 1760000000000,
      "by": "example",
      "byKind": "person",
      "closedAt": 1760000000000,
      "factId": "fct_a1b2c3",
      "kind": "example",
      "layer": "person",
      "learnedAt": 1760000000000,
      "lesson": {
        "how": "edit",
        "scope": "you",
        "used": 1
      },
      "lowRisk": true,
      "noteId": "not_a1b2c3",
      "ownerRef": "agt_a1b2c3",
      "sourceKind": "chat",
      "sourceLink": "example",
      "sourceRef": "example",
      "sourceTitle": "example",
      "status": "proposed",
      "subject": {
        "kind": "example",
        "pageId": "example",
        "title": "example"
      },
      "text": "example",
      "trashReason": "example",
      "trashedAt": 1760000000000,
      "validFrom": 1760000000000,
      "validTo": 1760000000000,
      "versions": 1
    },
    "why": "off"
  }
}
```
