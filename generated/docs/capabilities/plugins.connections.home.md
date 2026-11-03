# plugins.connections.home

Every connection you can use, for Vault > Connections: yours (Mine), the Space's (for everyone or your groups), your agents' own, and the servers plugins bring, each with its health, who can use it, which agents used it and when

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/plugins/connections/home |
| MCP tool | plugins_connections_home (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  mine: Array<{
      key: string;
      kind: "mcp" | "plugin" | "hub" | "skill";
      name: string;
      title: string;
      scope: "mine" | "space" | "agent";
      connectionId?: string;
      pluginId?: string;
      owner?: string;
      agentId?: string;
      share: Array<string>;
      transport: "stdio" | "http" | "sse" | "ws";
      address: string;
      source: "registry" | "paste" | "import" | "hub" | "skill" | "kit" | "hand" | "plugin";
      sourceRef?: string;
      auth?: "oauth";
      hub?: "composio" | "pipedream";
      enabled: boolean;
      health: "ok" | "needs_signin" | "key_refused" | "not_answering" | "needs_setup" | "off" | "unknown";
      healthNote?: string;
      tools?: number;
      checkedAt?: number;
      usedAt?: number;
      usedBy: Array<string>;
      keys: Array<string>;
      needs: Array<string>;
      canManage: boolean;
    }>;
  space: Array<{
      key: string;
      kind: "mcp" | "plugin" | "hub" | "skill";
      name: string;
      title: string;
      scope: "mine" | "space" | "agent";
      connectionId?: string;
      pluginId?: string;
      owner?: string;
      agentId?: string;
      share: Array<string>;
      transport: "stdio" | "http" | "sse" | "ws";
      address: string;
      source: "registry" | "paste" | "import" | "hub" | "skill" | "kit" | "hand" | "plugin";
      sourceRef?: string;
      auth?: "oauth";
      hub?: "composio" | "pipedream";
      enabled: boolean;
      health: "ok" | "needs_signin" | "key_refused" | "not_answering" | "needs_setup" | "off" | "unknown";
      healthNote?: string;
      tools?: number;
      checkedAt?: number;
      usedAt?: number;
      usedBy: Array<string>;
      keys: Array<string>;
      needs: Array<string>;
      canManage: boolean;
    }>;
  agents: Array<{
      key: string;
      kind: "mcp" | "plugin" | "hub" | "skill";
      name: string;
      title: string;
      scope: "mine" | "space" | "agent";
      connectionId?: string;
      pluginId?: string;
      owner?: string;
      agentId?: string;
      share: Array<string>;
      transport: "stdio" | "http" | "sse" | "ws";
      address: string;
      source: "registry" | "paste" | "import" | "hub" | "skill" | "kit" | "hand" | "plugin";
      sourceRef?: string;
      auth?: "oauth";
      hub?: "composio" | "pipedream";
      enabled: boolean;
      health: "ok" | "needs_signin" | "key_refused" | "not_answering" | "needs_setup" | "off" | "unknown";
      healthNote?: string;
      tools?: number;
      checkedAt?: number;
      usedAt?: number;
      usedBy: Array<string>;
      keys: Array<string>;
      needs: Array<string>;
      canManage: boolean;
    }>;
  policy: {
    spaceAdders: "admins" | "managers";
    allowListOn: boolean;
    allowList: Array<string>;
  };
  canAddSpace: boolean;
  admin: boolean;
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
    "admin": true,
    "agents": [
      {
        "address": "example",
        "agentId": "agt_a1b2c3",
        "auth": "oauth",
        "canManage": true,
        "checkedAt": 1760000000000,
        "connectionId": "mcs_a1b2c3",
        "enabled": true,
        "health": "ok",
        "healthNote": "example",
        "hub": "composio",
        "key": "notion",
        "keys": [
          "example"
        ],
        "kind": "mcp",
        "name": "example",
        "needs": [
          "example"
        ],
        "owner": "example",
        "pluginId": "plg_a1b2c3",
        "scope": "mine",
        "share": [
          "example"
        ],
        "source": "registry",
        "sourceRef": "example",
        "title": "example",
        "tools": 1,
        "transport": "stdio",
        "usedAt": 1760000000000,
        "usedBy": [
          "agt_a1b2c3"
        ]
      }
    ],
    "canAddSpace": true,
    "mine": [
      {
        "address": "example",
        "agentId": "agt_a1b2c3",
        "auth": "oauth",
        "canManage": true,
        "checkedAt": 1760000000000,
        "connectionId": "mcs_a1b2c3",
        "enabled": true,
        "health": "ok",
        "healthNote": "example",
        "hub": "composio",
        "key": "notion",
        "keys": [
          "example"
        ],
        "kind": "mcp",
        "name": "example",
        "needs": [
          "example"
        ],
        "owner": "example",
        "pluginId": "plg_a1b2c3",
        "scope": "mine",
        "share": [
          "example"
        ],
        "source": "registry",
        "sourceRef": "example",
        "title": "example",
        "tools": 1,
        "transport": "stdio",
        "usedAt": 1760000000000,
        "usedBy": [
          "agt_a1b2c3"
        ]
      }
    ],
    "policy": {
      "allowList": [
        "example"
      ],
      "allowListOn": true,
      "spaceAdders": "admins"
    },
    "space": [
      {
        "address": "example",
        "agentId": "agt_a1b2c3",
        "auth": "oauth",
        "canManage": true,
        "checkedAt": 1760000000000,
        "connectionId": "mcs_a1b2c3",
        "enabled": true,
        "health": "ok",
        "healthNote": "example",
        "hub": "composio",
        "key": "notion",
        "keys": [
          "example"
        ],
        "kind": "mcp",
        "name": "example",
        "needs": [
          "example"
        ],
        "owner": "example",
        "pluginId": "plg_a1b2c3",
        "scope": "mine",
        "share": [
          "example"
        ],
        "source": "registry",
        "sourceRef": "example",
        "title": "example",
        "tools": 1,
        "transport": "stdio",
        "usedAt": 1760000000000,
        "usedBy": [
          "agt_a1b2c3"
        ]
      }
    ]
  }
}
```
