# memory.profile.suggest

Suggest a fact for the person's public profile ("Add to your public profile?"); it stays private until they say yes in About you; with text, it is remembered privately first

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/profile/suggest |
| MCP tool | memory_profile_suggest (memory) |
| CLI | none |
| Emits | memory.fact_proposed, memory.fact_accepted, memory.learned |

## Input

```ts
type In = {
  factId?: string;
  text?: string;
  threadId?: string;
};
```

## Output

```ts
type Out = {
  fact: {
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
    place: "public" | "private";
    suggested?: boolean;
    lineLink?: string;
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
    "factId": "fct_a1b2c3",
    "text": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "fact": {
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
      "lineLink": "vyre://thread/thr_a1b2c3?m=msg_a1b2c3",
      "lowRisk": true,
      "noteId": "not_a1b2c3",
      "ownerRef": "agt_a1b2c3",
      "place": "public",
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
      "suggested": true,
      "text": "example",
      "trashReason": "example",
      "trashedAt": 1760000000000,
      "validFrom": 1760000000000,
      "validTo": 1760000000000,
      "versions": 1
    }
  }
}
```
