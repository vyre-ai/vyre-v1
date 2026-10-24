# import.list

History of imports

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.create |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/import/list |
| MCP tool | import_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  imports: Array<{
      importId: string;
      source: "csv" | "excel" | "airtable" | "notion" | "google_sheets";
      type: string;
      state: "staged" | "running" | "done" | "failed" | "canceled";
      runId?: string;
      by: string;
      at: number;
      created: number;
      updated: number;
      skipped: number;
      failed: number;
      ranAutomations: boolean;
      errorsFileId?: string;
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
    "type": "contact"
  },
  "output": {
    "imports": [
      {
        "at": 1760000000000,
        "by": "example",
        "created": 1,
        "errorsFileId": "fil_a1b2c3",
        "failed": 1,
        "importId": "imp_a1b2c3",
        "ranAutomations": true,
        "runId": "run_a1b2c3",
        "skipped": 1,
        "source": "csv",
        "state": "staged",
        "type": "contact",
        "updated": 1
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
