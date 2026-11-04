# browser.sites.list

The Browser connections: sites agents may use, where each runs, and each agent's right (Read only or Act). A person sees their own; an agent sees the sites that name it

| | |
|---|---|
| Module | browser |
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
| HTTP | POST /v1/browser/sites/list |
| MCP tool | browser_sites_list (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  sites: Array<{
      id: string;
      host: string;
      runsIn: "chrome" | "computers" | "both";
      rights: Array<{
          agentId: string;
          right: "read" | "act";
        }>;
      at: number;
      updatedAt: number;
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
    "sites": [
      {
        "at": 1760000000000,
        "host": "app.gohighlevel.com",
        "id": "bsi_a1b2c3",
        "rights": [
          {
            "agentId": "agt_a1b2c3",
            "right": "read"
          }
        ],
        "runsIn": "chrome",
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
