# schema.types.get

Read one record type with every field

| | |
|---|---|
| Module | schema |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/schema/types/get |
| MCP tool | schema_types_get (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
};
```

## Output

```ts
type Out = {
  type: {
    key: string;
    title: string;
    plural: string;
    icon: string;
    label: "public" | "internal" | "confidential" | "restricted";
    system: boolean;
    template?: "project";
    group?: string;
    titleField: string;
    summaryField?: string;
    statusField?: string;
    ownerField?: string;
    workspace?: boolean;
    scope?: string;
    syncedFrom?: string;
    attribution?: boolean;
    retention?: string;
    fields: Array<{
        key: string;
        type: string;
        title: string;
        label?: "public" | "internal" | "confidential" | "restricted";
        required?: boolean;
        unique?: boolean;
        default?: unknown;
        validate?: {
          expr: string;
          message: string;
        };
        lockAfter?: "approval";
        merge?: "lww" | "assistant" | "text-crdt" | "append";
        writeOnlyBy?: Array<string>;
        options?: Record<string, unknown>;
      }>;
    version: number;
  };
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
    "type": "contact"
  },
  "output": {
    "type": {
      "attribution": true,
      "fields": [
        {
          "default": {},
          "key": "phone",
          "label": "public",
          "lockAfter": "approval",
          "merge": "lww",
          "options": {},
          "required": true,
          "title": "example",
          "type": "text",
          "unique": true,
          "validate": {
            "expr": "example",
            "message": "example"
          },
          "writeOnlyBy": [
            "example"
          ]
        }
      ],
      "group": "example",
      "icon": "example",
      "key": "contact",
      "label": "public",
      "ownerField": "phone",
      "plural": "example",
      "retention": "example",
      "scope": "example",
      "statusField": "phone",
      "summaryField": "phone",
      "syncedFrom": "example",
      "system": true,
      "template": "project",
      "title": "example",
      "titleField": "phone",
      "version": 1,
      "workspace": true
    }
  }
}
```
