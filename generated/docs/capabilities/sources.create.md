# sources.create

Set up a source: a connector source or a generic webhook with a mapping into a record type

| | |
|---|---|
| Module | sources |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (create under /connector) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/sources/create |
| MCP tool | sources_create (records) |
| CLI | none |
| Emits | source.created |

## Input

```ts
type In = {
  connector: string;
  title: string;
  type: string;
  mapping: {
    dedupe: string;
    fields: Array<{
        from: string;
        to: string;
        transform?: string;
      }>;
    match: Array<string>;
    link?: Array<string>;
  };
  verify?: "hmac" | "signature" | "none";
  secretName?: string;
  connectionId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  source: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "connector": "hubspot",
    "idempotencyKey": "idem_1",
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
    "secretName": "example",
    "title": "example",
    "type": "contact",
    "verify": "hmac"
  },
  "output": {
    "source": {
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
  }
}
```
