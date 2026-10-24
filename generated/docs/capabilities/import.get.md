# import.get

Read one import: state, counts and the file of row errors

| | |
|---|---|
| Module | import |
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
| HTTP | POST /v1/import/get |
| MCP tool | import_get (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  importId: string;
};
```

## Output

```ts
type Out = {
  import: {
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
  };
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
    "importId": "imp_a1b2c3"
  },
  "output": {
    "import": {
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
  }
}
```
