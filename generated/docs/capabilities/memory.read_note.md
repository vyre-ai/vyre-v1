# memory.read_note

Read one memory note as Markdown

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/noteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/read_note |
| MCP tool | read_note (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  noteId: string;
};
```

## Output

```ts
type Out = {
  note: {
    noteId: string;
    path: string;
    title: string;
    layer: "person" | "agent" | "project" | "space";
    agentId?: string;
    updatedAt: number;
  };
  markdown: string;
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
    "noteId": "not_a1b2c3"
  },
  "output": {
    "markdown": "example",
    "note": {
      "agentId": "agt_a1b2c3",
      "layer": "person",
      "noteId": "not_a1b2c3",
      "path": "Agents/Intake/memory/notes/clients.md",
      "title": "example",
      "updatedAt": 1760000000000
    }
  }
}
```
