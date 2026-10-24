# sources.list

List sources, optionally those feeding one record type (the Sources page on a record type)

| | |
|---|---|
| Module | sources |
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
| HTTP | POST /v1/sources/list |
| MCP tool | sources_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: string;
  state?: "active" | "paused" | "failing";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  sources: Array<{
      sourceId: string;
      key: string;
      title: string;
      connector?: string;
      connectionId?: string;
      path: string;
      verify: "hmac" | "signature" | "none";
      type: string;
      state: "active" | "paused" | "failing";
      lastReceivedAt?: number;
      received24h: number;
      failed24h: number;
      mapping?: {
        dedupe: string;
        fields: Array<{
            from: string;
            to: string;
            transform?: string;
          }>;
        match: Array<string>;
        link?: Array<string>;
      };
    }>;
  next?: string;
  total?: number;
};
```

## Errors

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
    "cursor": "example",
    "limit": 1,
    "state": "active",
    "type": "contact"
  },
  "output": {
    "next": "example",
    "sources": [
      {
        "connectionId": "con_a1b2c3",
        "connector": "hubspot",
        "failed24h": 1,
        "key": "stripe",
        "lastReceivedAt": 1760000000000,
        "mapping": {
          "dedupe": "/id",
          "fields": [
            {
              "from": "/customer/email",
              "to": "email",
              "transform": "example"
            }
          ],
          "link": [
            "email"
          ],
          "match": [
            "email"
          ]
        },
        "path": "/hooks/stripe",
        "received24h": 1,
        "sourceId": "src_a1b2c3",
        "state": "active",
        "title": "example",
        "type": "contact",
        "verify": "hmac"
      }
    ],
    "total": 1
  }
}
```
