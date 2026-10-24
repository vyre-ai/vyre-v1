# sources.preview_mapping

Dry-run a mapping on a sample payload: the normalised row, create or update, and the linking outcome

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
| HTTP | POST /v1/sources/preview_mapping |
| MCP tool | sources_preview_mapping (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  sourceId?: string;
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
  type?: string;
  payload: unknown;
};
```

## Output

```ts
type Out = {
  normalized: Record<string, unknown>;
  action: "create" | "update" | "skip";
  link: {
    sure?: string;
    unsure: Array<{
        recordId: string;
        type: string;
        score: number;
        reasons: Array<string>;
      }>;
  };
  problems: Array<string>;
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
    "payload": {},
    "sourceId": "src_a1b2c3",
    "type": "contact"
  },
  "output": {
    "action": "create",
    "link": {
      "sure": "rec_a1b2c3",
      "unsure": [
        {
          "reasons": [
            "example"
          ],
          "recordId": "rec_a1b2c3",
          "score": 1,
          "type": "contact"
        }
      ]
    },
    "normalized": {},
    "problems": [
      "example"
    ]
  }
}
```
