- Three rc.21 live tests are green again. The agent that works a task answers a person in the task thread without an @, but a reviewer's own line no longer wakes it. An AI step's brief posted into a task's thread no longer wakes the agent a second time, because the task's baton does.
- The jobs.wake live test now uses no made-up helper model as the helper rule requires.
- The question guard no longer refuses short real questions ("Who signed?"). It refuses only placeholders: no words, "test", "hi", "question 1", lorem ipsum.

## What's new
- Agents on a task wake once when it is handed to them, not twice.
