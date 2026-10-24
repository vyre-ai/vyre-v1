# reports.get

Read one report

| | |
|---|---|
| Module | reports-client |
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
| HTTP | POST /v1/reports/get |
| MCP tool | reports_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  reportId: string;
};
```

## Output

```ts
type Out = {
  reportId: string;
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
    errors?: Array<{
        code: string;
        message: string;
        at: number;
        traceId?: string;
      }>;
    clientLogFileId?: string;
    note?: string;
  };
  status: string;
  issueNumber?: number;
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
    "reportId": "rpt_a1b2c3"
  },
  "output": {
    "bundle": {
      "clientLogFileId": "fil_a1b2c3",
      "context": {
        "hash": "example",
        "itemId": "example",
        "place": "example"
      },
      "errors": [
        {
          "at": 1760000000000,
          "code": "example",
          "message": "example",
          "traceId": "0123456789abcdef0123456789abcdef"
        }
      ],
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
    "issueNumber": 1,
    "reportId": "rpt_a1b2c3",
    "status": "example"
  }
}
```
