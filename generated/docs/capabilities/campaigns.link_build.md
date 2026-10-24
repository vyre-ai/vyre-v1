# campaigns.link_build

Campaign link builder: UTM and click-id parameters for a destination

| | |
|---|---|
| Module | campaigns |
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
| HTTP | POST /v1/campaigns/link_build |
| MCP tool | campaigns_link_build (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  url: string;
  source: string;
  medium: string;
  campaign: string;
};
```

## Output

```ts
type Out = {
  url: string;
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
  "input": {
    "campaign": "example",
    "medium": "example",
    "source": "example",
    "url": "example"
  },
  "output": {
    "url": "example"
  }
}
```
