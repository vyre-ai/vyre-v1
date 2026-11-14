# Vault requests (vault-requests)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (13)

- [vault.connect](../capabilities/vault.connect.md): Is X connected, connect X (Fathom, Slack), or before saying you cannot reach X. The person gets one card; you get connected, waiting or declined.
- [vault.connect_card.ask_admin](../capabilities/vault.connect_card.ask_admin.md): Ask an admin to connect the service when this person may not
- [vault.connect_card.disconnect](../capabilities/vault.connect_card.disconnect.md): Disconnect the service; the key stays in the Vault
- [vault.connect_card.get](../capabilities/vault.connect_card.get.md): The connect card of one request: its state, the fields, who can fill it, where the key is kept
- [vault.connect_card.options](../capabilities/vault.connect_card.options.md): Where the key can be kept: Mine, the shared folders an agent can use, and those it cannot
- [vault.connect_card.reopen](../capabilities/vault.connect_card.reopen.md): Open a card the person folded with Not now
- [vault.connect_card.submit](../capabilities/vault.connect_card.submit.md): Try the key, connect the service and keep the key; nothing is kept unless the key works. The values are in this call only
- [vault.request](../capabilities/vault.request.md): Ask for a missing key that is not a service (a key a skill or run needs, by name): creates a request task for the managers of the folder (or the Space vault managers) and tells the requester its status. For a service the person names, use vault_connect
- [vault.requests.cancel](../capabilities/vault.requests.cancel.md): Withdraw my own key request
- [vault.requests.decline](../capabilities/vault.requests.decline.md): Decline a key request with a note
- [vault.requests.fulfil](../capabilities/vault.requests.fulfil.md): Supply the key: attach an existing item, or save new fields as an item in the requested folder; say who may use it through the agent that asked
- [vault.requests.get](../capabilities/vault.requests.get.md): One key request with its task and status
- [vault.requests.list](../capabilities/vault.requests.list.md): Key requests I made, or waiting on me as a folder manager

## Events (4)

- [vault.request_canceled](../events/vault.request_canceled.md): The requester withdrew a key request
- [vault.request_declined](../events/vault.request_declined.md): A key request was declined with a note
- [vault.request_fulfilled](../events/vault.request_fulfilled.md): A requested key was supplied; the waiting run can resume
- [vault.requested](../events/vault.requested.md): A key was asked for; the folder managers get a task
