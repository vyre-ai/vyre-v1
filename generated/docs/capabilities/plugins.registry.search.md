# plugins.registry.search

Search the MCP server catalog (the official MCP registry). Answers from the last fetch when the registry cannot be reached, and says so.

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
| HTTP | POST /v1/plugins/registry/search |
| MCP tool | plugins_registry_search (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q?: string;
  cursor?: string;
  source?: "official" | "smithery";
  limit?: number;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      id: string;
      source: "official" | "smithery";
      name: string;
      title: string;
      description: string;
      version: string;
      website?: string;
      repository?: string;
      remote?: {
        url: string;
        transport: "http" | "sse";
        headers: Array<{
            name: string;
            description: string;
            required: boolean;
            secret: boolean;
            value?: string;
          }>;
      };
      package?: {
        registry: "npm" | "pypi" | "oci";
        runner: "npx" | "uvx" | "docker";
        identifier: string;
        version: string;
        env: Array<{
            name: string;
            description: string;
            required: boolean;
            secret: boolean;
            value?: string;
          }>;
      };
      signIn: "oauth" | "key" | "none";
      allowed: boolean;
    }>;
  next?: string;
  offline: boolean;
  fetchedAt?: number;
  source: "official" | "smithery";
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
    "cursor": "example",
    "limit": 1,
    "q": "example",
    "source": "official"
  },
  "output": {
    "entries": [
      {
        "allowed": true,
        "description": "example",
        "id": "example",
        "name": "com.notion/mcp",
        "package": {
          "env": [
            {
              "description": "example",
              "name": "example",
              "required": true,
              "secret": true,
              "value": "example"
            }
          ],
          "identifier": "example",
          "registry": "npm",
          "runner": "npx",
          "version": "example"
        },
        "remote": {
          "headers": [
            {
              "description": "example",
              "name": "example",
              "required": true,
              "secret": true,
              "value": "example"
            }
          ],
          "transport": "http",
          "url": "example"
        },
        "repository": "example",
        "signIn": "oauth",
        "source": "official",
        "title": "example",
        "version": "example",
        "website": "example"
      }
    ],
    "fetchedAt": 1760000000000,
    "next": "example",
    "offline": true,
    "source": "official"
  }
}
```
