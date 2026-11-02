# company.status

Where Connect your company stands: the provider, each step and whether it is done, the next step, and which doc section explains it. Read this first; it never asks twice

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/company/status |
| MCP tool | company_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  started: boolean;
  providers?: Array<{
      key: "google" | "microsoft";
      title: string;
    }>;
  provider?: "google" | "microsoft";
  title?: string;
  data?: {
    mail: boolean;
    calendar: boolean;
    files: boolean;
  };
  doc?: string;
  steps?: Array<{
      id: string;
      title: string;
      doc: string;
      done: boolean;
      optional?: boolean;
    }>;
  next?: string;
  requireSso?: boolean;
  signInOn?: boolean;
  signInTried?: boolean;
  recoveryKey?: boolean;
  domain?: string;
  tenant?: string;
  who?: string;
  probeLine?: string;
  keyHandle?: string;
  connected?: boolean;
  connectedAt?: number;
  mapped?: number;
  excluded?: Array<string>;
  space?: string;
  redirect?: string;
  clientId?: string;
  lastSweep?: string;
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
  "input": {},
  "output": {
    "clientId": "example",
    "connected": true,
    "connectedAt": 1760000000000,
    "data": {
      "calendar": true,
      "files": true,
      "mail": true
    },
    "doc": "example",
    "domain": "example",
    "excluded": [
      "maya@example.com"
    ],
    "keyHandle": "example",
    "lastSweep": "example",
    "mapped": 1,
    "next": "example",
    "probeLine": "example",
    "provider": "google",
    "providers": [
      {
        "key": "google",
        "title": "example"
      }
    ],
    "recoveryKey": true,
    "redirect": "example",
    "requireSso": true,
    "signInOn": true,
    "signInTried": true,
    "space": "example",
    "started": true,
    "steps": [
      {
        "doc": "example",
        "done": true,
        "id": "example",
        "optional": true,
        "title": "example"
      }
    ],
    "tenant": "example",
    "title": "example",
    "who": "example"
  }
}
```
