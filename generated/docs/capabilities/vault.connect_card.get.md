# vault.connect_card.get

The connect card of one request: its state, the fields, who can fill it, where the key is kept

| | |
|---|---|
| Module | vault-requests |
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
| HTTP | POST /v1/vault/connect_card/get |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  card: {
    requestId: string;
    state: "ask" | "have" | "admin" | "asked" | "connected" | "wrong" | "offline" | "later" | "gone";
    service: {
      key: string;
      title: string;
      site?: string;
    };
    fields: Array<{
        name: string;
        label: string;
        optional: boolean;
      }>;
    choice?: {
      name: string;
      label: string;
      options: Array<{
          value: string;
          label: string;
          connector: string;
          hosts: Array<string>;
        }>;
    };
    problem?: "permission";
    agentId?: string;
    mayFill: boolean;
    admin?: {
      id: string;
      askedAt?: number;
    };
    have?: {
      itemId: string;
      name: string;
      keptIn: string;
    };
    keptIn?: string;
    tested?: string;
    notice?: string;
    checks: boolean;
    checksWith?: string;
    connectedBy?: string;
    connectionId?: string;
    usedBy: Array<{
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      }>;
  };
};
```

## Errors

- internal.not_implemented
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "requestId": "vrq_a1b2c3"
  },
  "output": {
    "card": {
      "admin": {
        "askedAt": 1760000000000,
        "id": "usr_a1b2c3"
      },
      "agentId": "agt_a1b2c3",
      "checks": true,
      "checksWith": "example",
      "choice": {
        "label": "example",
        "name": "example",
        "options": [
          {
            "connector": "hubspot",
            "hosts": [
              "example"
            ],
            "label": "example",
            "value": "example"
          }
        ]
      },
      "connectedBy": "usr_a1b2c3",
      "connectionId": "con_a1b2c3",
      "fields": [
        {
          "label": "example",
          "name": "example",
          "optional": true
        }
      ],
      "have": {
        "itemId": "vit_a1b2c3",
        "keptIn": "example",
        "name": "example"
      },
      "keptIn": "example",
      "mayFill": true,
      "notice": "example",
      "problem": "permission",
      "requestId": "vrq_a1b2c3",
      "service": {
        "key": "hubspot",
        "site": "example",
        "title": "example"
      },
      "state": "ask",
      "tested": "example",
      "usedBy": [
        {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      ]
    }
  }
}
```
