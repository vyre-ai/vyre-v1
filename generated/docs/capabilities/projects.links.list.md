# projects.links.list

What is linked to a project (records, files, chats, tasks, artifacts, mail threads, calendar events, pull requests, commits, CI runs, web addresses), each with its state read live from the source, and the rules that link by themselves

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/links/list |
| MCP tool | projects_links_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
  kind?: "record" | "file" | "chat" | "task" | "artifact" | "mail_thread" | "calendar_event" | "github.pr" | "github.commit" | "ci.run" | "url";
};
```

## Output

```ts
type Out = {
  links: Array<{
      linkId: string;
      projectId: string;
      kind: "record" | "file" | "chat" | "task" | "artifact" | "mail_thread" | "calendar_event" | "github.pr" | "github.commit" | "ci.run" | "url";
      ref: string;
      source: "manual" | "agent" | "rule";
      addedBy: string;
      ruleId?: string;
      addedAt: number;
      state?: string;
      label?: string;
      url?: string;
    }>;
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
    "kind": "record",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "links": [
      {
        "addedAt": 1760000000000,
        "addedBy": "example",
        "kind": "record",
        "label": "example",
        "linkId": "lnk_a1b2c3",
        "projectId": "prj_a1b2c3",
        "ref": "vyre-ai/website#12",
        "ruleId": "example",
        "source": "manual",
        "state": "example",
        "url": "example"
      }
    ],
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
