# projects.templates.list

Project templates: record types derived from Project and template projects from installed Kits

| | |
|---|---|
| Module | projects |
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
| HTTP | POST /v1/projects/templates/list |
| MCP tool | projects_templates_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  templates: Array<{
      key: string;
      title: string;
      type: string;
      stages: Array<string>;
      source: "builtin" | "kit";
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
    "templates": [
      {
        "key": "example",
        "source": "builtin",
        "stages": [
          "example"
        ],
        "title": "example",
        "type": "contact"
      }
    ]
  }
}
```
