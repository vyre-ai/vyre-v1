# projects.links.rules.set

Set the rules that link matching new items to the project: a repository, a record filter or an email domain

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/links/rules/set |
| MCP tool | projects_links_rules_set (records) |
| CLI | none |
| Emits | project.link_rules_set |

## Input

```ts
type In = {
  projectId: string;
  rules: Array<{
      ruleId?: string;
      kind: "repo" | "record_filter" | "email_domain";
      repo?: string;
      recordType?: string;
      field?: string;
      equals?: string;
      domain?: string;
    }>;
};
```

## Output

```ts
type Out = {
  rules: Array<{
      ruleId: string;
      kind: "repo" | "record_filter" | "email_domain";
      repo?: string;
      recordType?: string;
      field?: string;
      equals?: string;
      domain?: string;
      by: string;
      at: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3",
    "rules": [
      {
        "domain": "client.com",
        "equals": "example",
        "field": "example",
        "kind": "repo",
        "recordType": "contact",
        "repo": "vyre-ai/website",
        "ruleId": "example"
      }
    ]
  },
  "output": {
    "rules": [
      {
        "at": 1760000000000,
        "by": "example",
        "domain": "client.com",
        "equals": "example",
        "field": "example",
        "kind": "repo",
        "recordType": "contact",
        "repo": "vyre-ai/website",
        "ruleId": "rul_a1b2c3"
      }
    ]
  }
}
```
