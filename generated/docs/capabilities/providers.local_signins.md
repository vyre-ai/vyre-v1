# providers.local_signins

Which Claude Code and Codex sign-ins are on the computer this Space runs on: yes or no for each, never a path or an account name. The AI card shows its "on this computer" rows only for a yes.

| | |
|---|---|
| Module | vault |
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
| HTTP | POST /v1/providers/local_signins |
| MCP tool | providers_local_signins (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  claudeCode: boolean;
  codex: boolean;
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
    "claudeCode": true,
    "codex": true
  }
}
```
