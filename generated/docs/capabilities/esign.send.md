# esign.send

Send a PDF for signature; built-in signing returns a link per signer and emails it when the Space can

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.shared_send |
| Grant level | use |
| Risk | high |
| Resource | file (/fileId) |
| Gate | signature_send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/esign/send |
| MCP tool | esign_send (files) |
| CLI | none |
| Emits | signature.sent |

## Input

```ts
type In = {
  fileId: string;
  recordId?: string;
  signers: Array<{
      name: string;
      email?: string;
      order?: number;
    }>;
  provider?: "vyre" | "documenso" | "dropbox_sign" | "docusign";
  message?: string;
  places?: Array<unknown>;
  plainOk?: boolean;
  expiresInDays?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  envelopeId: string;
  links?: Array<{
      index: number;
      name: string;
      email?: string;
      url?: string;
      path?: string;
    }>;
  emailed?: Array<string>;
  notice?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "expiresInDays": 1,
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "message": "example",
    "places": [
      {}
    ],
    "plainOk": true,
    "provider": "vyre",
    "recordId": "rec_a1b2c3",
    "signers": [
      {
        "email": "example",
        "name": "example",
        "order": 1
      }
    ]
  },
  "output": {
    "emailed": [
      "example"
    ],
    "envelopeId": "env_a1b2c3",
    "links": [
      {
        "email": "example",
        "index": 1,
        "name": "example",
        "path": "example",
        "url": "example"
      }
    ],
    "notice": "example"
  }
}
```
