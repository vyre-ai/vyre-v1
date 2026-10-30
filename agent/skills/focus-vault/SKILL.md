---
name: focus-vault
description: Work in the Vault. Use a secret by handle, never the value; request a missing key; add items; share; AI provider accounts.
system: true
---

# Vault

The Vault holds secrets as named items with KEY=value fields, like a shareable .env. Items are Mine (under the person's own key) or Shared
(under the Space key, decrypted only by the Vault service at the moment of use). Providers at the top are the AI accounts that pay for chats.

## The one rule
You never see a value. `vault_use` takes an item `item` name and returns a handle such as `#Dana_Lawmatics` and the field names. Put `#Dana_Lawmatics.api_key`
where the value goes: a terminal environment variable (`terminal_run` `env`), an HTTP header, or a browser field (`chrome_fill`). Vyre swaps the value in at the last
moment and scrubs it from the output. Never print, store, summarise, encode or send a value, and never put one in a memory fact, a message, a file or a plan.

## Using and finding
- `vault_items_list` lists names and metadata, never values. `vault_items_match` finds the item for a site or a service.
- If the item you need is not listed for you, `vault_request` with the name and the reason. The managers of the folder get a task.
  Give the `folderId` of the shared folder the key should live in (`vault_folders_list`): its managers decide. With none, the Space owner and admins decide.
  Say you are waiting, and what you will do when it arrives. Do not ask the person to paste the key in chat.
- If someone pastes a secret into chat, do not repeat it. Offer a secret field (a `secret_input` block) so it goes straight to the Vault.

## Adding and changing
- `vault_item_put` adds an item: a `name`, a `kind`, `fields` as key and value, a `folderId`. The value comes from a client-only secret field, not from you.
  You can create the structure (the item and the field names) and let the person fill the value.
- `vault_item_update`, `vault_item_move`, `vault_item_mark_rotated`, `vault_item_history`. `vault_item_usage` shows the AI turns and tokens metered on an AI account item, per agent and person.
- `vault_share` and `vault_unshare` change who may use an item. Sharing is access: say who gets what level before you do it.
- `vault_generate` makes a password; `vault_health` shows weak, reused and old items.
- `vault_export_env` and `vault_inject_env` are for the person's command line; do not run them for yourself.

## AI accounts
- `providers_list` shows connected accounts and engines. `providers_test` checks one. Connecting a subscription runs the sign-in on the person's side.
  `providers_set_space_use` lets the Space use an account; it spends someone's money, so the person decides.

## Habits
- Name the item, never quote a field value. Say which handle you used and for what: "I used #Dana_Lawmatics to run the sync."
- If a call fails with a missing-access error, say which item and offer Ask for access.
