# sync.snapshot.begin

Start an initial sync or resync: pins a read snapshot at asOfSeq and returns the plan of entities and row estimates

| | |
|---|---|
| Module | sync |
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
| HTTP | POST /sync/v1/snapshot/begin |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  entities?: Array<string>;
  deviceClass: "desktop" | "phone" | "web";
};
```

## Output

```ts
type Out = {
  asOfSeq: number;
  plan: Array<{
      entity: string;
      estimatedRows: number;
    }>;
  expiresAt: number;
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
    "deviceClass": "desktop",
    "entities": [
      "example"
    ]
  },
  "output": {
    "asOfSeq": 1,
    "expiresAt": 1760000000000,
    "plan": [
      {
        "entity": "example",
        "estimatedRows": 1
      }
    ]
  }
}
```
