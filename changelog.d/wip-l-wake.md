- Three rc.21 live tests are green again. The agent that works a task answers a person in the task thread without an @, but a reviewer's own line no longer wakes it. The brief posted into a task's thread no longer wakes the agent a second time, because the task's baton does.
- The jobs.wake and needs.asks live tests now use a helper model that exists and a question of more than two words, as the helper and question rules require.

## What's new
- Agents on a task wake once when it is handed to them, not twice.
