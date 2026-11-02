# company.people_done

A person has looked at who is in; the flow moves on to the one confirmation

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/company/people_done |
| MCP tool | company_people_done (engineer) |
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
