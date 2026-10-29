# memory.export_markdown

The whole brain the reader can see as one Markdown document: pages with their facts, Notes and links, then the facts no page names; personal memory only when asked, and only the reader's own

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
| HTTP | POST /v1/memory/export_markdown |
| MCP tool | memory_export_markdown (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  includePersonal?: boolean;
};
```

## Output

```ts
type Out = {
  markdown: string;
  pages: number;
  facts: number;
  bytes: number;
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
    "includePersonal": true
  },
  "output": {
    "bytes": 1,
    "facts": 1,
    "markdown": "example",
    "pages": 1
  }
}
```
