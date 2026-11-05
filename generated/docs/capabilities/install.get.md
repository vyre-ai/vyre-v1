# install.get

One plan, as its card draws it: what it is, what it needs, the commit, who can get it, and for an update the diff

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
| HTTP | POST /v1/install/get |
| MCP tool | install_get (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  planId: string;
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
    version?: string;
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
      fromVersion?: string;
      toVersion?: string;
      older?: boolean;
      newAccess?: Array<string>;
      added: Array<string>;
      removed: Array<string>;
      changed: Array<{
          path: string;
          plus: Array<string>;
          minus: Array<string>;
        }>;
    };
  };
  updateOf?: string;
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
    "planId": "ins_a1b2c3"
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
        "fromVersion": "example",
        "newAccess": [
          "example"
        ],
        "older": true,
        "removed": [
          "example"
        ],
        "to": "example",
        "toVersion": "example"
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
      "version": "example",
      "who": [
        {
          "adminOnly": true,
          "allowed": true,
          "key": "me",
          "label": "example"
        }
      ]
    },
    "updateOf": "ins_a1b2c3"
  }
}
```
