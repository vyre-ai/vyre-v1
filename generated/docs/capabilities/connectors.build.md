# connectors.build

Run the build-connector flow: read the app docs, draft the connector, ask for a key through a Vault request, run the harness

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/build |
| MCP tool | connectors_build (engineer) |
| CLI | vyre connector build |
| Emits | connector.built |

## Input

```ts
type In = {
  key: string;
  docsUrl?: string;
  notes?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId: string;
  draftId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "docsUrl": "example",
    "idempotencyKey": "idem_1",
    "key": "hubspot",
    "notes": "example"
  },
  "output": {
    "draftId": "cdr_a1b2c3",
    "runId": "run_a1b2c3"
  }
}
```
