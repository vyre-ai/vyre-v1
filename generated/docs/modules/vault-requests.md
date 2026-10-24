# Vault requests (vault-requests)

Lane L7a. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (6)

- [vault.request](../capabilities/vault.request.md): Ask for a missing key: creates a request task for the managers of the folder (or the Space vault managers) and tells the requester its status
- [vault.requests.cancel](../capabilities/vault.requests.cancel.md): Withdraw my own key request
- [vault.requests.decline](../capabilities/vault.requests.decline.md): Decline a key request with a note
- [vault.requests.fulfil](../capabilities/vault.requests.fulfil.md): Supply the key: attach an existing item, or save new fields as an item in the requested folder
- [vault.requests.get](../capabilities/vault.requests.get.md): One key request with its task and status
- [vault.requests.list](../capabilities/vault.requests.list.md): Key requests I made, or waiting on me as a folder manager

## Events (4)

- [vault.request_canceled](../events/vault.request_canceled.md): The requester withdrew a key request
- [vault.request_declined](../events/vault.request_declined.md): A key request was declined with a note
- [vault.request_fulfilled](../events/vault.request_fulfilled.md): A requested key was supplied; the waiting run can resume
- [vault.requested](../events/vault.requested.md): A key was asked for; the folder managers get a task
