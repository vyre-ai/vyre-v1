# sync_specs.sample

Read one page of an app, read-only (GET only), with a Vault handle as the key: where the lists are, what one item holds, how the next page is asked for, a total if there is one. Also reads field-metadata and schema endpoints

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_specs/sample |
| MCP tool | sync_specs_sample (records) |
| CLI | vyre sync-spec sample |
| Emits | none |

## Input

```ts
type In = {
  auth: {
    vaultHandle: string;
    style: "bearer" | "header" | "basic";
    header?: string;
    prefix?: string;
    headers?: Record<string, string>;
  };
  domain: string;
  path: string;
  query?: Record<string, string>;
  url?: string;
  items?: number;
};
```

## Output

```ts
type Out = {
  status: number;
  ok: boolean;
  reason?: string;
  nextLink?: string;
  items?: Array<unknown>;
  preview?: string;
  shape?: {
    kind: "object" | "array" | "empty" | "text";
    lists: Array<{
        itemsAt: string;
        count: number;
        idAt?: string;
        updatedAtGuess?: string;
        fields: Array<{
            path: string;
            type: string;
            seen: number;
            example?: string;
          }>;
      }>;
    cursors: Array<{
        pointer: string;
        value: string;
      }>;
    totals: Array<{
        pointer: string;
        value: number;
      }>;
    keys?: Array<string>;
  };
  estimate?: {
    count: number;
    source: string;
  };
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "auth": {
      "header": "example",
      "headers": {},
      "prefix": "example",
      "style": "bearer",
      "vaultHandle": "#Dana_Lawmatics"
    },
    "domain": "api.example.com",
    "items": 1,
    "path": "/contacts",
    "query": {},
    "url": "example"
  },
  "output": {
    "estimate": {
      "count": 1,
      "source": "example"
    },
    "items": [
      {}
    ],
    "nextLink": "example",
    "ok": true,
    "preview": "example",
    "reason": "example",
    "shape": {
      "cursors": [
        {
          "pointer": "example",
          "value": "example"
        }
      ],
      "keys": [
        "example"
      ],
      "kind": "object",
      "lists": [
        {
          "count": 1,
          "fields": [
            {
              "example": "example",
              "path": "example",
              "seen": 1,
              "type": "example"
            }
          ],
          "idAt": "example",
          "itemsAt": "example",
          "updatedAtGuess": "example"
        }
      ],
      "totals": [
        {
          "pointer": "example",
          "value": 1
        }
      ]
    },
    "status": 1
  }
}
```
