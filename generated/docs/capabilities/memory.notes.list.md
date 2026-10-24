# memory.notes.list

List memory notes of an agent, project or the Space, including proposed/ and recipes/

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
| HTTP | POST /v1/memory/notes/list |
| MCP tool | memory_notes_list (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId?: string;
  projectId?: string;
  layer?: "person" | "agent" | "project" | "space";
  area?: "notes" | "proposed" | "recipes" | "journal";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "area": "notes",
    "cursor": "example",
    "layer": "person",
    "limit": 1,
    "projectId": "prj_a1b2c3"
  },
  "output": {
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
