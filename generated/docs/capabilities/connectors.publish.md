# connectors.publish

Publish a draft after a fresh test run; a failing test keeps the last good version live

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/publish |
| MCP tool | connectors_publish (engineer) |
| CLI | vyre connector publish |
| Emits | connector.published, connector.publish_failed |

## Input

```ts
type In = {
  key: string;
  draftId?: string;
  note?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  published: boolean;
  version?: string;
  result: {
    passed: number;
    failed: number;
    cases: Array<{
        name: string;
        ok: boolean;
        message?: string;
      }>;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "draftId": "cdr_a1b2c3",
    "idempotencyKey": "idem_1",
    "key": "hubspot",
    "note": "example"
  },
  "output": {
    "published": true,
    "result": {
      "cases": [
        {
          "message": "example",
          "name": "example",
          "ok": true
        }
      ],
      "failed": 1,
      "passed": 1
    },
    "version": "example"
  }
}
```
