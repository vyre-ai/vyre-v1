# templates.preview

Preview what a template adds before installing

| | |
|---|---|
| Module | templates |
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
| HTTP | POST /v1/templates/preview |
| MCP tool | templates_preview (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  templateId: string;
};
```

## Output

```ts
type Out = {
  template: {
    templateId: string;
    title: string;
    kind: "agent" | "automation" | "journey" | "record_type" | "runbook" | "project" | "site" | "form" | "portal";
    summary: string;
    version: string;
    adds: Array<string>;
  };
  record_types: Array<string>;
  domains: Array<string>;
  vaultNames: Array<string>;
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
    "templateId": "tpl_a1b2c3"
  },
  "output": {
    "domains": [
      "example"
    ],
    "record_types": [
      "example"
    ],
    "template": {
      "adds": [
        "example"
      ],
      "kind": "agent",
      "summary": "example",
      "templateId": "tpl_a1b2c3",
      "title": "example",
      "version": "example"
    },
    "vaultNames": [
      "example"
    ]
  }
}
```
