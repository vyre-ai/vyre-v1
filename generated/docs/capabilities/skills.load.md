# skills.load

Load the full text of one skill by name (SKILL.md body and its supporting files); agent skills win over Space ones, Space ones over built-in

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
| HTTP | POST /v1/skills/load |
| MCP tool | load_skill (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  skill: {
    name: string;
    description: string;
    tier: "builtin" | "space" | "agent";
    source: string;
    body: string;
    files: Array<{
        path: string;
        text: string;
      }>;
  };
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
    "agentId": "agt_a1b2c3",
    "name": "deploy-checks"
  },
  "output": {
    "skill": {
      "body": "example",
      "description": "example",
      "files": [
        {
          "path": "example",
          "text": "example"
        }
      ],
      "name": "example",
      "source": "example",
      "tier": "builtin"
    }
  }
}
```
