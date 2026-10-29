# agents.builtin_skill.get

Read one built-in skill by name, the full SKILL.md: Working in Vyre, the focus skill of a place (focus-records, focus-files, focus-automations, focus-vault, focus-inbox, focus-apps, focus-console), agent-loops, agent-computer

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
| HTTP | POST /v1/agents/builtin_skill/get |
| MCP tool | agents_builtin_skill_get (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
};
```

## Output

```ts
type Out = {
  name: string;
  description: string;
  body: string;
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
    "name": "focus-records"
  },
  "output": {
    "body": "example",
    "description": "example",
    "name": "example"
  }
}
```
