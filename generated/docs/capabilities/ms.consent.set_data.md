# ms.consent.set_data

Choose Mail, Calendar and Files separately after setup. What is turned off stops for everyone; what is turned on comes in for everyone included

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | connection_change when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/consent/set_data |
| MCP tool | ms_consent_set_data (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  data: {
    mail: boolean;
    calendar: boolean;
    files: boolean;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  data: {
    mail: boolean;
    calendar: boolean;
    files: boolean;
  };
  permissions: Array<string>;
  exchangeRoles: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "data": {
      "calendar": true,
      "files": true,
      "mail": true
    },
    "idempotencyKey": "idem_1"
  },
  "output": {
    "data": {
      "calendar": true,
      "files": true,
      "mail": true
    },
    "exchangeRoles": [
      "example"
    ],
    "permissions": [
      "example"
    ]
  }
}
```
