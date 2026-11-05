# Talk (talk)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (11)

- [talk.ask_key](../capabilities/talk.ask_key.md): Post the secret card that asks for a Talk key in this chat: their own, or the Space's. The value goes straight to the Vault and never into the chat
- [talk.configure](../capabilities/talk.configure.md): Change a person's Talk: on or off, provider, language, model. An agent may do this for the person it acts for. Keys go through talk_ask_key
- [talk.connect](../capabilities/talk.connect.md): A person adds or replaces their own Talk key: it is checked with the provider at once, then kept in their Mine folder. A person does this, never an agent
- [talk.disconnect](../capabilities/talk.disconnect.md): A person removes their own Talk key from the Vault
- [talk.session](../capabilities/talk.session.md): Open one Talk session: mints a short-lived provider token and the socket address. Own key first, then the Space key. Audited per person; the key itself never leaves the server
- [talk.space.check](../capabilities/talk.space.check.md): Check the Space key now: a real one-second grant against the provider the Space picked, with the key from the Vault
- [talk.space.configure](../capabilities/talk.space.configure.md): Turn Talk for everyone on or off, and pick which provider (Deepgram or ElevenLabs) covers people; its key must be added first. An agent's change stops at the Gate for someone who may approve it
- [talk.space.connect](../capabilities/talk.space.connect.md): An admin adds or replaces the key that covers everyone: it is checked at once, then kept in a Restricted Shared folder. A person does this, never an agent
- [talk.space.disconnect](../capabilities/talk.space.disconnect.md): Remove the Space key from the Vault; people with their own key keep working
- [talk.space.status](../capabilities/talk.space.status.md): Talk for everyone in the Space: whether a key is set, on or off, who set it, when it was last checked and how many people use their own key
- [talk.status](../capabilities/talk.status.md): Talk for the person asking: on or off, provider, language, model and what covers them (their own key, the Space key or nothing). Never a key

## Events (5)

- [talk.configured](../events/talk.configured.md): A person's Talk choices changed
- [talk.connected](../events/talk.connected.md): A Talk key was added or replaced in the Vault (no value)
- [talk.disconnected](../events/talk.disconnected.md): A Talk key was removed
- [talk.space_changed](../events/talk.space_changed.md): Talk for everyone in the Space was turned on or off
- [talk.space_checked](../events/talk.space_checked.md): The Space key was checked with the provider
