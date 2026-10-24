# settings.pages

The ten settings pages in their two groups (named after the Space, and Everywhere) with row counts

| | |
|---|---|
| Module | settings |
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
| HTTP | POST /v1/settings/pages |
| MCP tool | settings_pages (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  pages: Array<{
      key: string;
      title: string;
      group: "space" | "everywhere";
      rows: number;
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
    "pages": [
      {
        "group": "space",
        "key": "example",
        "rows": 1,
        "title": "example"
      }
    ]
  }
}
```
