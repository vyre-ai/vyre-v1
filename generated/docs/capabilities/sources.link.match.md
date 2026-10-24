# sources.link.match

The shared linking step: find a sure match or unsure candidates for a normalised row

| | |
|---|---|
| Module | sources |
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
| HTTP | POST /v1/sources/link/match |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  row: Record<string, unknown>;
  by?: Array<string>;
};
```

## Output

```ts
type Out = {
  sure?: string;
  unsure: Array<{
      recordId: string;
      type: string;
      score: number;
      reasons: Array<string>;
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
  "input": {
    "by": [
      "email"
    ],
    "row": {},
    "type": "contact"
  },
  "output": {
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
  }
}
```
