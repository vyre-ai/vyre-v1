# reports.submit

Submit a problem report (queued offline, sent on reconnect with the original trace ids)

| | |
|---|---|
| Module | reports-client |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/reports/submit |
| MCP tool | reports_submit (meta) |
| CLI | none |
| Emits | report.submitted |

## Input

```ts
type In = {
  bundle: {
    context: {
      place: string;
      itemId?: string;
      hash?: string;
    };
    traceIds: Array<string>;
    events: Array<{
        type: string;
        at: number;
        traceId?: string;
      }>;
    versions: {
      app: string;
      server: string;
      device: string;
    };
    screenshotFileId?: string;
    note?: string;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  reportId: string;
  taskId: string;
  sentToVyre: boolean;
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
    "bundle": {
      "context": {
        "hash": "example",
        "itemId": "example",
        "place": "example"
      },
      "events": [
        {
          "at": 1760000000000,
          "traceId": "0123456789abcdef0123456789abcdef",
          "type": "example"
        }
      ],
      "note": "example",
      "screenshotFileId": "fil_a1b2c3",
      "traceIds": [
        "0123456789abcdef0123456789abcdef"
      ],
      "versions": {
        "app": "example",
        "device": "example",
        "server": "example"
      }
    },
    "idempotencyKey": "idem_1"
  },
  "output": {
    "reportId": "rpt_a1b2c3",
    "sentToVyre": true,
    "taskId": "tsk_a1b2c3"
  }
}
```
