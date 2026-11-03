# skills.page

Settings > Skills for the person asking: cards for skills shared with them, their own skills (Mine), the Space skills an admin set, the built-in ones, and their agents to assign them to

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
| HTTP | POST /v1/skills/page |
| MCP tool | skills_page (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId?: string;
};
```

## Output

```ts
type Out = {
  waiting: Array<{
      skillId: string;
      name: string;
      label?: string;
      description: string;
      sharer: string;
      sharerName: string;
      toSpace: boolean;
      source: string;
      origin: string;
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
      state: "waiting" | "added" | "not_now";
      growth: Array<string>;
      agents: Array<string>;
      enabled: boolean;
      setup: Record<string, string>;
      needs: Array<string>;
      updatedAt: number;
    }>;
  mine: Array<{
      skillId: string;
      name: string;
      label?: string;
      description: string;
      source: string;
      origin: string;
      version?: string;
      projectId?: string;
      agents: Array<string>;
      enabled: boolean;
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
      setup: Record<string, string>;
      needs: Array<string>;
      sharedWith: Array<string>;
      updatedAt: number;
    }>;
  shared: Array<{
      skillId: string;
      name: string;
      label?: string;
      description: string;
      sharer: string;
      sharerName: string;
      toSpace: boolean;
      source: string;
      origin: string;
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
      state: "waiting" | "added" | "not_now";
      growth: Array<string>;
      agents: Array<string>;
      enabled: boolean;
      setup: Record<string, string>;
      needs: Array<string>;
      updatedAt: number;
    }>;
  space: Array<{
      skillId: string;
      name: string;
      label?: string;
      description: string;
      source: string;
      origin: string;
      version?: string;
      enabled: boolean;
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
      setup: Record<string, string>;
      needs: Array<string>;
      from?: string;
      updatedAt?: number;
    }>;
  builtin: Array<{
      name: string;
      description: string;
    }>;
  agents: Array<{
      agentId: string;
      name: string;
    }>;
  policy: {
    scriptsAdminOnly: boolean;
  };
  admin: boolean;
  me: string;
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
  "input": {
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "admin": true,
    "agents": [
      {
        "agentId": "agt_a1b2c3",
        "name": "example"
      }
    ],
    "builtin": [
      {
        "description": "example",
        "name": "example"
      }
    ],
    "me": "example",
    "mine": [
      {
        "agents": [
          "example"
        ],
        "description": "example",
        "enabled": true,
        "label": "example",
        "name": "example",
        "needs": [
          "example"
        ],
        "origin": "example",
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
        "projectId": "prj_a1b2c3",
        "setup": {},
        "sharedWith": [
          "example"
        ],
        "skillId": "sko_a1b2c3",
        "source": "example",
        "updatedAt": 1760000000000,
        "version": "example"
      }
    ],
    "policy": {
      "scriptsAdminOnly": true
    },
    "shared": [
      {
        "agents": [
          "example"
        ],
        "description": "example",
        "enabled": true,
        "growth": [
          "example"
        ],
        "label": "example",
        "name": "example",
        "needs": [
          "example"
        ],
        "origin": "example",
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
        "setup": {},
        "sharer": "example",
        "sharerName": "example",
        "skillId": "sko_a1b2c3",
        "source": "example",
        "state": "waiting",
        "toSpace": true,
        "updatedAt": 1760000000000,
        "version": "example"
      }
    ],
    "space": [
      {
        "description": "example",
        "enabled": true,
        "from": "example",
        "label": "example",
        "name": "example",
        "needs": [
          "example"
        ],
        "origin": "example",
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
        "setup": {},
        "skillId": "example",
        "source": "example",
        "updatedAt": 1760000000000,
        "version": "example"
      }
    ],
    "waiting": [
      {
        "agents": [
          "example"
        ],
        "description": "example",
        "enabled": true,
        "growth": [
          "example"
        ],
        "label": "example",
        "name": "example",
        "needs": [
          "example"
        ],
        "origin": "example",
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
        "setup": {},
        "sharer": "example",
        "sharerName": "example",
        "skillId": "sko_a1b2c3",
        "source": "example",
        "state": "waiting",
        "toSpace": true,
        "updatedAt": 1760000000000,
        "version": "example"
      }
    ]
  }
}
```
