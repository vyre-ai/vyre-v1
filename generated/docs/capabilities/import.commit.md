# import.commit

Write the previewed rows as an import Run; no automations fire unless runAutomations is true

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.create |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/import/commit |
| MCP tool | import_commit (records) |
| CLI | vyre import commit |
| Emits | import.started, import.completed, import.failed, schema.changed |

## Input

```ts
type In = {
  importId: string;
  previewToken: string;
  runAutomations?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId: string;
  importId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "importId": "imp_a1b2c3",
    "previewToken": "example",
    "runAutomations": true
  },
  "output": {
    "importId": "imp_a1b2c3",
    "runId": "run_a1b2c3"
  }
}
```
