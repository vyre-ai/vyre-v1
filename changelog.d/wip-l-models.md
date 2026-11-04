## What's new

- The model list only shows models your accounts can use. When a model turns out not to work (Beam Free was the first), it leaves the list at once and comes back on its own later, or as soon as it answers again.
- If a model can't answer, Vyre runs your message again right away on the next best one: the same provider first, then your last pick, then the Space default. The chat gets one quiet line ("Beam Free isn't available on this account, so this reply used GLM 5.3."), and that model becomes your pick for the next chat.
- When none of your AI accounts can answer, you see one plain card with Open AI accounts. Codes and traces stay inside Details.
- The engine's own command-line advice ("Run --model to pick a different model") no longer shows up in chats.
- Models on an API key or a Claude Code, Codex or Grok sign-in are checked in the background with one tiny request each (one at a time for a sign-in). Until a model is confirmed it shows greyed as "Checking...", and one the provider refuses never appears.
- Connecting, removing or changing an AI sign-in or key makes Vyre check that account's models again.
- Vyre remembers your last three distinct model picks, so when one fails it tries the others before the Space default.
- A model you pick is checked right away, even when it is past the background check's limit.
