# memory.page.versions

Every version of the Notes of a page, newest first, with who wrote it and when

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
| HTTP | POST /v1/memory/page/versions |
| MCP tool | memory_page_versions (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  pageId: string;
};
```

## Output

```ts
type Out = {
  versions: Array<{
      version: number;
      by: string;
      actorKind: "person" | "agent" | "upkeep" | "system";
      at: number;
      reason?: string;
      notes: string;
    }>;
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
    "pageId": "example"
  },
  "output": {
    "versions": [
      {
        "actorKind": "person",
        "at": 1760000000000,
        "by": "example",
        "notes": "example",
        "reason": "example",
        "version": 1
      }
    ]
  }
}
```
