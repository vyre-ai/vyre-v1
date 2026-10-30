# memory.facts.list

List facts by layer, agent, status or "From you"; proposed facts wait here for acceptance

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
| HTTP | POST /v1/memory/facts/list |
| MCP tool | memory_facts_list (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  layer?: "person" | "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
  status?: Array<"proposed" | "current" | "closed" | "removed">;
  fromMe?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  facts: Array<{
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
      subject?: {
        pageId: string;
        title: string;
        kind: string;
      };
      sourceTitle?: string;
      by?: string;
      byKind?: "person" | "agent" | "upkeep" | "system";
      versions?: number;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "fromMe": true,
    "layer": "person",
    "limit": 1,
    "projectId": "prj_a1b2c3",
    "q": "example",
    "status": [
      "proposed"
    ]
  },
  "output": {
    "facts": [
      {
        "agentId": "agt_a1b2c3",
        "archivedAt": 1760000000000,
        "by": "example",
        "byKind": "person",
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
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
