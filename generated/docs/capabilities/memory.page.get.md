# memory.page.get

Open a page by id or title: its facts, its Notes, the [[links]] it makes and the chats, runs, records and pages that link to it

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
| HTTP | POST /v1/memory/page/get |
| MCP tool | memory_open_page (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  pageId?: string;
  title?: string;
  layer?: "person" | "agent" | "project" | "space";
  agentId?: string;
  projectId?: string;
};
```

## Output

```ts
type Out = {
  page: {
    pageId: string;
    title: string;
    kind: "person" | "client" | "project" | "agent" | "record" | "topic" | "decision" | "site";
    layer: "person" | "agent" | "project" | "space";
    ownerRef: string;
    agentId?: string;
    projectId?: string;
    subjectRef?: string;
    version: number;
    createdAt: number;
    updatedAt: number;
    trashedAt?: number;
    archivedAt?: number;
  };
  notes: string;
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
    }>;
  links: Array<{
      label: string;
      title: string;
      pageId?: string;
      evidence: string;
    }>;
  backlinks: Array<{
      kind: "page" | "chat" | "run" | "record";
      ref: string;
      title: string;
      quote: string;
      link?: string;
      at: number;
      label?: string;
    }>;
  versions: number;
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
    "layer": "person",
    "pageId": "example",
    "projectId": "prj_a1b2c3",
    "title": "example"
  },
  "output": {
    "backlinks": [
      {
        "at": 1760000000000,
        "kind": "page",
        "label": "example",
        "link": "example",
        "quote": "example",
        "ref": "example",
        "title": "example"
      }
    ],
    "facts": [
      {
        "agentId": "agt_a1b2c3",
        "archivedAt": 1760000000000,
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
        "status": "proposed",
        "text": "example",
        "trashReason": "example",
        "trashedAt": 1760000000000,
        "validFrom": 1760000000000,
        "validTo": 1760000000000
      }
    ],
    "links": [
      {
        "evidence": "example",
        "label": "example",
        "pageId": "example",
        "title": "example"
      }
    ],
    "notes": "example",
    "page": {
      "agentId": "agt_a1b2c3",
      "archivedAt": 1760000000000,
      "createdAt": 1760000000000,
      "kind": "person",
      "layer": "person",
      "ownerRef": "example",
      "pageId": "example",
      "projectId": "prj_a1b2c3",
      "subjectRef": "example",
      "title": "example",
      "trashedAt": 1760000000000,
      "updatedAt": 1760000000000,
      "version": 1
    },
    "versions": 1
  }
}
```
