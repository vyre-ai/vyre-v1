# skills.preview

Read the skills in a link (a SKILL.md, a GitHub repo or folder, a zip), a dropped folder or a zip, with what each can touch. Nothing is saved

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
| HTTP | POST /v1/skills/preview |
| MCP tool | skills_preview (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  link?: string;
  zip?: string;
  files?: Record<string, string>;
  hint?: string;
  marketplace?: {
    marketplaceId: string;
    plugin: string;
  };
};
```

## Output

```ts
type Out = {
  skills: Array<{
      name: string;
      description: string;
      text: string;
      files: Record<string, string>;
      path: string;
      source: string;
      kind: "skill" | "plugin" | "codex";
      version?: string;
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
      taken?: string;
    }>;
  problems: Array<string>;
  skipped: Array<string>;
  source: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "files": {},
    "hint": "example",
    "link": "https://github.com/anthropics/skills/tree/main/pdf",
    "marketplace": {
      "marketplaceId": "mkt_a1b2c3",
      "plugin": "example"
    },
    "zip": "example"
  },
  "output": {
    "problems": [
      "example"
    ],
    "skills": [
      {
        "description": "example",
        "files": {},
        "kind": "skill",
        "name": "example",
        "path": "example",
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
        "taken": "example",
        "text": "example",
        "version": "example"
      }
    ],
    "skipped": [
      "example"
    ],
    "source": "example"
  }
}
```
