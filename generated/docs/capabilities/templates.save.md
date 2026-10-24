# templates.save

Save an agent, Automation, Journey, record type, runbook or project as a template

| | |
|---|---|
| Module | templates |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.publish |
| Grant level | edit |
| Risk | medium |
| Resource | kit (create under /ref) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/templates/save |
| MCP tool | templates_save (sites) |
| CLI | none |
| Emits | template.saved |

## Input

```ts
type In = {
  kind: "agent" | "automation" | "journey" | "record_type" | "runbook" | "project" | "site" | "form" | "portal";
  ref: string;
  title: string;
  idempotencyKey: string;
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
  "input": {
    "idempotencyKey": "idem_1",
    "kind": "agent",
    "ref": "example",
    "title": "example"
  },
  "output": {
    "template": {
      "adds": [
        "example"
      ],
      "kind": "agent",
      "summary": "example",
      "templateId": "tpl_a1b2c3",
      "title": "example",
      "version": "example"
    }
  }
}
```
