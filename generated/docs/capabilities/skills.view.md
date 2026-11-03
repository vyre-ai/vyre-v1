# skills.view

The full text and files of one skill: your own, one shared with you (before you add it, too), a Space one or a built-in one

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
| HTTP | POST /v1/skills/view |
| MCP tool | skills_view (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  skillId?: string;
  name?: string;
};
```

## Output

```ts
type Out = {
  skill: {
    name: string;
    description: string;
    text: string;
    files: Array<{
        path: string;
        bytes: number;
        text: string;
      }>;
    perms: {
      scripts: Array<string>;
      mcpServers: Array<{
          name: string;
          transport: "stdio" | "http" | "sse" | "ws";
          target: string;
          keys: Array<string>;
        }>;
      network: Array<string>;
      vaultKeys: Array<string>;
    };
    source: string;
    version?: string;
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
    "name": "example",
    "skillId": "example"
  },
  "output": {
    "skill": {
      "description": "example",
      "files": [
        {
          "bytes": 1,
          "path": "example",
          "text": "example"
        }
      ],
      "name": "example",
      "perms": {
        "mcpServers": [
          {
            "keys": [
              "example"
            ],
            "name": "example",
            "target": "example",
            "transport": "stdio"
          }
        ],
        "network": [
          "example"
        ],
        "scripts": [
          "example"
        ],
        "vaultKeys": [
          "example"
        ]
      },
      "source": "example",
      "text": "example",
      "version": "example"
    }
  }
}
```
