# esign.providers

Signing services and the default

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
      key: "vyre" | "documenso" | "dropbox_sign" | "docusign";
      title: string;
      default: boolean;
      connected: boolean;
      why?: string;
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
        "key": "vyre",
        "title": "example",
        "why": "example"
      }
    ]
  }
}
```
