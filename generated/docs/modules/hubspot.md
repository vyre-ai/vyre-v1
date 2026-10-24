# HubSpot (hubspot)

Lane L3. Kind connector. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (4)

- [hubspot.health](../capabilities/hubspot.health.md): Probe: GET account details
- [hubspot.list_objects](../capabilities/hubspot.list_objects.md): List remote objects of a type (contacts, companies, deals) for mapping
- [hubspot.push_object](../capabilities/hubspot.push_object.md): Push one record change to HubSpot (stores the replaced value so the push can be undone)
- [hubspot.test_connection](../capabilities/hubspot.test_connection.md): Check the HubSpot token and portal

## Events (1)

- [hubspot.webhook_received](../events/hubspot.webhook_received.md): A HubSpot webhook arrived and was verified
