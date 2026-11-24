# mail.setup.status

The Space's email setup in one read: how it sends, what is missing and the next step

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | comms.domains |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/setup/status |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  provider: "resend" | "mailgun" | "smtp";
  smtp: {
    configured: boolean;
    host?: string;
    port?: number;
    security?: "starttls" | "tls";
    username?: string;
    state: "none" | "unchecked" | "ok" | "failed";
    detail?: string;
    checkedAt?: number;
  };
  domains: Array<{
      id: string;
      name: string;
      provider: "resend" | "mailgun" | "smtp";
      spf: "pass" | "fail" | "pending";
      dkim: "pass" | "fail" | "pending";
      dmarc: "pass" | "fail" | "pending";
      verified: boolean;
      isDefault: boolean;
      checkedAt?: number;
    }>;
  rechecks: Array<{
      domainId: string;
      failures: number;
      why?: string;
      checkedAt?: number;
    }>;
  cleanups: Array<{
      id: string;
      kind: "provider_route" | "duplicate_route";
      note: string;
      attempts: number;
      lastError?: string;
      createdAt: number;
    }>;
  done: Array<"choose_provider" | "connect_server" | "add_domain" | "publish_dns" | "set_default" | "ready">;
  step: "choose_provider" | "connect_server" | "add_domain" | "publish_dns" | "set_default" | "ready";
  next: string;
  ready: boolean;
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
    "cleanups": [
      {
        "attempts": 1,
        "createdAt": 1760000000000,
        "id": "example",
        "kind": "provider_route",
        "lastError": "example",
        "note": "example"
      }
    ],
    "domains": [
      {
        "checkedAt": 1760000000000,
        "dkim": "pass",
        "dmarc": "pass",
        "id": "dom_a1b2c3",
        "isDefault": true,
        "name": "mail.example.com",
        "provider": "resend",
        "spf": "pass",
        "verified": true
      }
    ],
    "done": [
      "choose_provider"
    ],
    "next": "example",
    "provider": "resend",
    "ready": true,
    "rechecks": [
      {
        "checkedAt": 1760000000000,
        "domainId": "dom_a1b2c3",
        "failures": 1,
        "why": "example"
      }
    ],
    "smtp": {
      "checkedAt": 1760000000000,
      "configured": true,
      "detail": "example",
      "host": "smtp.example.com",
      "port": 1,
      "security": "starttls",
      "state": "none",
      "username": "example"
    },
    "step": "choose_provider"
  }
}
```
