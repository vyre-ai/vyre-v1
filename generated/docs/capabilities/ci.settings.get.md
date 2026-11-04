# ci.settings.get

The CI settings: whether runners are on, the cloud provider, the Vault item that holds its key (never the key), region, machine size, image, how many at once, the monthly cap, the time limit and the labels. Admin only

| | |
|---|---|
| Module | ci |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ci/settings/get |
| MCP tool | ci_settings_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
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
  keyReady: boolean;
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
  "input": {},
  "output": {
    "keyReady": true,
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
