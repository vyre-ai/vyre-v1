# agents.builtin_skills.list

Skills every agent carries, led by "Working in Vyre": save facts to the asker layer, propose promotions, cite sources, use secrets only by name, never copy data across Spaces

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/agents/builtin_skills/list |
| MCP tool | agents_builtin_skills_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  skills: Array<{
      key: string;
      title: string;
      version: string;
      summary: string;
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
    "skills": [
      {
        "key": "working_in_vyre",
        "summary": "example",
        "title": "example",
        "version": "1.0.0"
      }
    ]
  }
}
```
