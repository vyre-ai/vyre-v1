# ci.settings.set

Turn runners on or off and change their settings. Admin only, audited. Turning them on needs a key (a Vault item) and a monthly cap

| | |
|---|---|
| Module | ci |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ci/settings/set |
| MCP tool | ci_settings_set (engineer) |
| CLI | none |
| Emits | ci.settings_changed |

## Input

```ts
type In = {
  enabled?: boolean;
  vaultKeyRef?: string | null;
  region?: string;
  size?: string;
  image?: string;
  maxConcurrent?: number;
  monthlyCapUsd?: number;
  maxJobMinutes?: number;
  labels?: Array<string>;
};
```

## Output

```ts
type Out = {
  settings: {
    enabled: boolean;
    provider: "digitalocean";
    vaultKeyRef: string | null;
    region: string;
    size: string;
    image: string;
    maxConcurrent: number;
    monthlyCapUsd: number;
    maxJobMinutes: number;
    labels: Array<string>;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "enabled": true,
    "image": "example",
    "labels": [
      "example"
    ],
    "maxConcurrent": 1,
    "maxJobMinutes": 5,
    "monthlyCapUsd": 1,
    "region": "example",
    "size": "example",
    "vaultKeyRef": "#Dana_Lawmatics"
  },
  "output": {
    "settings": {
      "enabled": true,
      "image": "ubuntu-24-04-x64",
      "labels": [
        "example"
      ],
      "maxConcurrent": 1,
      "maxJobMinutes": 5,
      "monthlyCapUsd": 1,
      "provider": "digitalocean",
      "region": "fra1",
      "size": "s-2vcpu-4gb",
      "vaultKeyRef": "#Dana_Lawmatics"
    }
  }
}
```
