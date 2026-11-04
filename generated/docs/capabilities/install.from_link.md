# install.from_link

Read a GitHub link (pinned to a commit) or an MCP server address and say what it is: a skill, a plugin, a local MCP server, a remote MCP server or a site, what it does, what it needs (network, Vault keys, files) and who can get it. Nothing is installed

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/install/from_link |
| MCP tool | install_from_link (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  url: string;
};
```

## Output

```ts
type Out = {
  plan: {
    planId: string;
    state: string;
    kind: "skill" | "plugin" | "mcp_local" | "mcp_remote" | "site";
    flavor?: "claude" | "codex";
    name: string;
    summary: string;
    repo: string;
    commit: string;
    url: string;
    path?: string;
    needs: {
      domains: Array<string>;
      vaultKeys: Array<string>;
      files: Array<string>;
    };
    runs?: {
      command: string;
      args: Array<string>;
    };
    skills: Array<string>;
    problems: Array<string>;
    card: {
      name: string;
      kind: string;
      summary: string;
      commit: string;
      needs: {
        domains: Array<string>;
        vaultKeys: Array<string>;
        files: Array<string>;
      };
    };
    who: Array<{
        key: "me" | "agent" | "space";
        label: string;
        allowed: boolean;
        adminOnly?: boolean;
      }>;
    runOn?: Array<{
        key: "sandbox" | "space";
        label: string;
        needs?: string;
      }>;
    diff?: {
      from: string;
      to: string;
      added: Array<string>;
      removed: Array<string>;
      changed: Array<{
          path: string;
          plus: Array<string>;
          minus: Array<string>;
        }>;
    };
  };
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

## Example

```json
{
  "name": "example",
  "input": {
    "url": "https://github.com/anthropics/skills/tree/main/pdf"
  },
  "output": {
    "plan": {
      "card": {
        "commit": "example",
        "kind": "example",
        "name": "example",
        "needs": {
          "domains": [
            "example"
          ],
          "files": [
            "example"
          ],
          "vaultKeys": [
            "example"
          ]
        },
        "summary": "example"
      },
      "commit": "example",
      "diff": {
        "added": [
          "example"
        ],
        "changed": [
          {
            "minus": [
              "example"
            ],
            "path": "example",
            "plus": [
              "example"
            ]
          }
        ],
        "from": "example",
        "removed": [
          "example"
        ],
        "to": "example"
      },
      "flavor": "claude",
      "kind": "skill",
      "name": "example",
      "needs": {
        "domains": [
          "example"
        ],
        "files": [
          "example"
        ],
        "vaultKeys": [
          "example"
        ]
      },
      "path": "example",
      "planId": "ins_a1b2c3",
      "problems": [
        "example"
      ],
      "repo": "example",
      "runOn": [
        {
          "key": "sandbox",
          "label": "example",
          "needs": "example"
        }
      ],
      "runs": {
        "args": [
          "example"
        ],
        "command": "example"
      },
      "skills": [
        "example"
      ],
      "state": "example",
      "summary": "example",
      "url": "example",
      "who": [
        {
          "adminOnly": true,
          "allowed": true,
          "key": "me",
          "label": "example"
        }
      ]
    }
  }
}
```
