# sources.ingest

Pipeline entry called by the public listener for /hooks/<source>: verify, dedupe on provider id, normalise, upsert, link

| | |
|---|---|
| Module | sources |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/sources/ingest |
| MCP tool | none |
| CLI | none |
| Emits | source.received, source.deduped, source.rejected, source.mapping_failed, source.linked, source.link_pending |

## Input

```ts
type In = {
  source: string;
  receivedAt: number;
  headers: Record<string, string>;
  body: string;
  runAutomations?: boolean;
};
```

## Output

```ts
type Out = {
  status: "accepted" | "duplicate" | "rejected" | "failed";
  deliveryId?: string;
  recordIds: Array<string>;
};
```

## Errors

- auth.unauthenticated
- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- rate_limit.exceeded
- validation.bad_input
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "body": "example",
    "headers": {},
    "receivedAt": 1760000000000,
    "runAutomations": true,
    "source": "stripe"
  },
  "output": {
    "deliveryId": "dlv_a1b2c3",
    "recordIds": [
      "rec_a1b2c3"
    ],
    "status": "accepted"
  }
}
```
