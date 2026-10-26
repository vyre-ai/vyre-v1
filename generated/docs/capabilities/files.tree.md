# files.tree

The roots of the file tree: Agents, Projects, People, Channels, shared knowledge, Agent template, Deployments, GitHub, plus Recent, Shared with me, Trash and Knowledge

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/files/tree |
| MCP tool | files_tree (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  roots: Array<{
      key: string;
      title: string;
      kind: "folder" | "virtual";
      folderId?: string;
      count: number;
      subject?: {
        kind: "agent" | "project" | "space";
        id?: string;
      };
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
  "input": {},
  "output": {
    "roots": [
      {
        "count": 1,
        "folderId": "fld_a1b2c3",
        "key": "example",
        "kind": "folder",
        "subject": {
          "id": "agt_a1b2c3",
          "kind": "agent"
        },
        "title": "example"
      }
    ]
  }
}
```
