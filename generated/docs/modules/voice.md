# Talk (voice)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (11)

- [voice.ask_key](../capabilities/voice.ask_key.md): Post the secret card that asks for a Talk key in this chat: their own, or the Space's. The value goes straight to the Vault and never into the chat
- [voice.configure](../capabilities/voice.configure.md): Change a person's Talk: on or off, provider, language, model. An agent may do this for the person it acts for. Keys go through voice_ask_key
- [voice.connect](../capabilities/voice.connect.md): A person adds or replaces their own Talk key: it is checked with the provider at once, then kept in their Mine folder. A person does this, never an agent
- [voice.disconnect](../capabilities/voice.disconnect.md): A person removes their own Talk key from the Vault
- [voice.session](../capabilities/voice.session.md): Open one Talk session: mints a short-lived provider token and the socket address. Own key first, then the Space key. Audited per person; the key itself never leaves the server
- [voice.space.check](../capabilities/voice.space.check.md): Check the Space key with the provider now
- [voice.space.configure](../capabilities/voice.space.configure.md): Turn Talk for everyone on or off, and keep the key. An agent's change stops at the Gate for someone who may approve it
- [voice.space.connect](../capabilities/voice.space.connect.md): An admin adds or replaces the key that covers everyone: it is checked at once, then kept in a Restricted Shared folder. A person does this, never an agent
- [voice.space.disconnect](../capabilities/voice.space.disconnect.md): Remove the Space key from the Vault; people with their own key keep working
- [voice.space.status](../capabilities/voice.space.status.md): Talk for everyone in the Space: whether a key is set, on or off, who set it, when it was last checked and how many people use their own key
- [voice.status](../capabilities/voice.status.md): Talk for the person asking: on or off, provider, language, model and what covers them (their own key, the Space key or nothing). Never a key

## Events (5)

- [voice.configured](../events/voice.configured.md): A person's Talk choices changed
- [voice.connected](../events/voice.connected.md): A Talk key was added or replaced in the Vault (no value)
- [voice.disconnected](../events/voice.disconnected.md): A Talk key was removed
- [voice.space_changed](../events/voice.space_changed.md): Talk for everyone in the Space was turned on or off
- [voice.space_checked](../events/voice.space_checked.md): The Space key was checked with the provider
