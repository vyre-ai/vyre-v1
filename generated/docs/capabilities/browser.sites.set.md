# browser.sites.set

Add a Browser connection, or change one: where it runs and which agents may Read only or Act. Sends, posts, payments and deletes are always held for you

| | |
|---|---|
| Module | browser |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/browser/sites/set |
| MCP tool | none |
| CLI | none |
| Emits | browser.site_changed |

## Input

```ts
type In = {
  host: string;
  runsIn: "chrome" | "computers" | "both";
  rights: Array<{
      agentId: string;
      right: "read" | "act";
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  site: {
    id: string;
    host: string;
    runsIn: "chrome" | "computers" | "both";
    rights: Array<{
        agentId: string;
        right: "read" | "act";
      }>;
    at: number;
    updatedAt: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "host": "app.gohighlevel.com",
    "idempotencyKey": "idem_1",
    "rights": [
      {
        "agentId": "agt_a1b2c3",
        "right": "read"
      }
    ],
    "runsIn": "chrome"
  },
  "output": {
    "site": {
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
  }
}
```
