# sites.metrics

How a site is running: CPU, memory, requests and response time, one point a minute over the last hour, six hours or day (at most 60 points), and the numbers for right now against the site's limits

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/metrics |
| MCP tool | sites_metrics (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  window?: "1h" | "6h" | "24h";
};
```

## Output

```ts
type Out = {
  window: "1h" | "6h" | "24h";
  samples: Array<{
      at: number;
      cpu: number;
      memMb: number;
      requests: number;
      errors: number;
      p50: number;
      p95: number;
    }>;
  now: {
    cpu: {
      value: number;
      of: number;
    };
    mem: {
      valueMb: number;
      ofMb: number;
    };
    requestsPerMin: number;
    p95: number;
    errorRate: number;
  };
  measured: boolean;
  requests: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "siteId": "sit_a1b2c3",
    "window": "1h"
  },
  "output": {
    "measured": true,
    "now": {
      "cpu": {
        "of": 1,
        "value": 1
      },
      "errorRate": 1,
      "mem": {
        "ofMb": 1,
        "valueMb": 1
      },
      "p95": 1,
      "requestsPerMin": 1
    },
    "requests": true,
    "samples": [
      {
        "at": 1760000000000,
        "cpu": 1,
        "errors": 1,
        "memMb": 1,
        "p50": 1,
        "p95": 1,
        "requests": 1
      }
    ],
    "window": "1h"
  }
}
```
