# projects.links.unlink

Take a link off a project; an item a rule linked is remembered as an exception and never comes back by rule

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/links/unlink |
| MCP tool | projects_links_unlink (records) |
| CLI | none |
| Emits | project.item_unlinked |

## Input

```ts
type In = {
  projectId: string;
  kind: "record" | "file" | "chat" | "task" | "artifact" | "mail_thread" | "calendar_event" | "github.pr" | "github.commit" | "ci.run" | "url";
  ref: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "kind": "record",
    "projectId": "prj_a1b2c3",
    "ref": "example"
  },
  "output": {
    "removed": true
  }
}
```
