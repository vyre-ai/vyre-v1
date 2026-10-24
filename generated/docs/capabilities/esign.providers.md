# esign.providers

Providers and which is the default (Documenso, unmodified container)

| | |
|---|---|
| Module | esign |
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
| HTTP | POST /v1/esign/providers |
| MCP tool | esign_providers (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  providers: Array<{
      key: "documenso" | "dropbox_sign" | "docusign";
      default: boolean;
      connected: boolean;
    }>;
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
  "input": {},
  "output": {
    "providers": [
      {
        "connected": true,
        "default": true,
        "key": "documenso"
      }
    ]
  }
}
```
