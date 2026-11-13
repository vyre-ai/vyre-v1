// What a person who is not the agent's owner gets of a shared agent's workspace (owner, 13 Nov 2026, P7 section 10 item 6: "a turn sees only the asker's work folder plus the agent's own home").
// One container, one user id: the bound is the shell's environment and the tool layer, not the kernel. A turn acting for such a person starts its shell with HOME, HISTFILE, the config and cache
// folders and its starting directory in a folder of their own under the agent's home, on a tmux server of their own (so `tmux ls` and `tmux capture-pane` in their shell show their sessions only),
// and the tool layer refuses a working directory or a command that names another person's folder. The agent's owner, a person's own Assistant and a turn acting for nobody keep the agent's home as it is.
// What this cannot close is in team/v1/REPORT-f-agentpc-2026-11-13.md: a deliberate `cat` of another folder by a path built in the shell, `ps`, and the tmux socket of another person found by listing /tmp.

/** The agent's home in its workspace container (workspace.ts WORKSPACE_HOME). */
const HOME = "/home/agent";
/** Where the folders of the people who use the agent live. */
export const PEOPLE_DIR = `${HOME}/people`;
/** Where each such person's tmux server keeps its socket (a tmpfs of the container: gone with it, made again by `ensureCommand`). */
const TMUX_DIR = "/tmp/vyre-tmux";

/** A person's folder name: their id, with anything a path would not carry made safe. */
export const folderOf = (person: string): string => person.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);

export interface AskerPlace {
  /** The person this place is for. */
  person: string;
  /** Their folder: HOME for their shell. */
  home: string;
  /** What their shell starts with. */
  env: Readonly<Record<string, string>>;
  /** The environment of every tmux call that touches their sessions: it picks their tmux server. */
  tmuxEnv: Readonly<Record<string, string>>;
}

export function askerPlace(person: string): AskerPlace {
  const f = folderOf(person);
  const home = `${PEOPLE_DIR}/${f}`;
  return {
    person,
    home,
    env: {
      HOME: home,
      HISTFILE: `${home}/.bash_history`,
      XDG_CONFIG_HOME: `${home}/.config`,
      XDG_CACHE_HOME: `${home}/.cache`,
      XDG_DATA_HOME: `${home}/.local/share`,
      XDG_STATE_HOME: `${home}/.local/state`,
      TMUX_TMPDIR: `${TMUX_DIR}/${f}`,
      // ssh looks for its keys and settings in the home the system lists for the user id (the agent's home), never in $HOME: so git over ssh is told, by name, to use this person's own and nothing else
      GIT_SSH_COMMAND: `ssh -F ${home}/.ssh/config -o IdentitiesOnly=yes -o IdentityFile=${home}/.ssh/id_ed25519 -o IdentityFile=${home}/.ssh/id_rsa -o UserKnownHostsFile=${home}/.ssh/known_hosts`,
    },
    tmuxEnv: { TMUX_TMPDIR: `${TMUX_DIR}/${f}` },
  };
}

/**
 * Makes the folder, the shell's usual start files (from /etc/skel, never over a file that is there) and the two links that keep `~/Vyre` and `~/projects` working under the new HOME, and the folder of
 * the person's tmux server. Safe to run again. `sh -c`, with the folders passed as arguments.
 */
export function ensureCommand(p: AskerPlace): string[] {
  return [
    "sh",
    "-c",
    'h="$1"; t="$2"; mkdir -p "$h/.config" "$h/.cache" "$h/.local/share" "$h/.local/state" "$h/.ssh" "$t" && chmod 700 "$h/.ssh" && cp -rn /etc/skel/. "$h"/ 2>/dev/null; ' +
      '[ -e "$h/.ssh/config" ] || : > "$h/.ssh/config"; ' +
      'for n in Vyre projects; do [ -e "$h/$n" ] || ln -s "/home/agent/$n" "$h/$n"; done; true',
    "sh",
    p.home,
    p.tmuxEnv["TMUX_TMPDIR"] ?? "",
  ];
}

/** The people's folders a path names that are not `person`'s: `/home/agent/people/<name>` or `~/people/<name>` in a working directory or a command. Empty when it names none. */
export function otherFolders(text: string, person: string): string[] {
  const mine = folderOf(person);
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:\/home\/agent|~|\$HOME|\$\{HOME\})\/people\/([A-Za-z0-9_.-]+)/g)) {
    const name = m[1] ?? "";
    if (name !== mine) found.add(name);
  }
  // the folder named without a prefix a shell would expand (a working directory is always absolute or starts with ~)
  return [...found];
}

/** Is `dir` (a working directory as given: absolute, or starting with ~) inside the people's folders but not this person's? */
export function inOtherFolder(dir: string, person: string): boolean {
  return otherFolders(dir.replace(/^~(?=\/|$)/, HOME), person).length > 0 || otherFolders(dir, person).length > 0;
}

/** The project folders a path names: `/home/agent/projects/<id>` or `~/projects/<id>`. */
export function projectsNamed(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\/home\/agent|~|\$HOME|\$\{HOME\})\/projects\/([A-Za-z0-9_-]+)/g))
    if (m[1]) out.add(m[1]);
  return [...out];
}
