# automations.templates.list

The starter templates: what each one does, what starts it and what to set up

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/templates/list |
| MCP tool | automations_templates_list (automations) |
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
      summary: string;
      starts: string;
      setUp: Array<string>;
      steps: Array<{
          id: string;
          key: string;
          title: string;
        }>;
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
        "setUp": [
          "example"
        ],
        "starts": "example",
        "steps": [
          {
            "id": "example",
            "key": "example",
            "title": "example"
          }
        ],
        "summary": "example",
        "title": "example"
      }
    ]
  }
}
```
