# memory.find_by_subject

Find every fact and note about one subject (a contact, company or person) for erase and export

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | memory.admin |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/memory/find_by_subject |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  subject: string;
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
    }>;
  notes: Array<{
      noteId: string;
      path: string;
      title: string;
      layer: "person" | "agent" | "project" | "space";
      agentId?: string;
      updatedAt: number;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "subject": "example"
  },
  "output": {
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
        "status": "proposed",
        "text": "example",
        "validFrom": 1760000000000,
        "validTo": 1760000000000
      }
    ],
    "next": "example",
    "notes": [
      {
        "agentId": "agt_a1b2c3",
        "layer": "person",
        "noteId": "not_a1b2c3",
        "path": "Agents/Intake/memory/notes/clients.md",
        "title": "example",
        "updatedAt": 1760000000000
      }
    ],
    "total": 1
  }
}
```
