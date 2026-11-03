## What's new
- "Set up its computer" works on a Team Space server. The server's container runner, the one process that holds the Docker socket, now makes agent computers too, and each agent's computer sits on a network of its own, so one cannot reach another.
- When no machine can run an agent computer, the Computer tab no longer shows a button that cannot work. It says why in plain words and what to do next (start the runner, start Docker Desktop or Colima, add a server with Docker).
- A failed write in the right pane, or a computer that will not start, sleep or record, says the real reason instead of "Try again".
- An agent's Computer tab is redesigned. With no computer it shows a small desktop picture, what the computer gives (its own Chrome with Vyre for Chrome, a terminal, a files folder shared with Vyre Files), a machine picker that shows each machine's room and picks the best, and one button. Setting up shows real progress, a failure shows the real reason with Copy details, and a ready computer shows a live thumbnail with Open, Sleep and the machine it runs on.
- The agent pane's tabs: Threads is now Chats, and Files and Terminal appear once the agent has a computer. The role shows in two lines, with the full text on hover, and the tab strip has one menu, not two.

## Behind the scenes
- The runner (`host/src/sites-runner`) has a second policy for computers (`computers-policy.ts`): the agent computer image only, the `vyre.computer` label, every capability dropped, a seccomp profile, its own network and profile volume, no host folder, no device, exec and archive only on a computer's own container and inside its own home, and a fixed removal helper. Refusals are tested against the policy and on a real engine.
- vyred reaches the runner with its token (`VYRE_SITES_RUNNER`), makes a network per computer, and joins the ingress to it for the Vault channel only. A connection that arrives on a computer's network may reach nothing but that route.
- `computers.hosts` and `computers.provision` carry the host's own reason (`explainEngine`), and provision refuses before it makes a row when the runtime cannot be used.
