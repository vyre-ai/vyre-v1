// What a person who is not the agent's owner gets of a shared agent's workspace (owner, 13 Nov 2026, P7 section 10 item 6: "a turn sees only the asker's work folder plus the agent's own home"; lead, 14 Nov:
// the boundary is the operating system, not the command text). Each such person is a Unix user of their own in the container (uid 20000 to 20999, a user named u<uid> in the image), their home
// /people/u<uid> is mode 0700 and made by that uid itself, and every command, terminal and tmux call of theirs runs as that uid (Docker's exec takes a user; no capability is needed). The agent's own home
// /home/agent is 0700 owned by 10001, so for these uids it, ~/Vyre and ~/projects under it, the owner's tmux server (/tmp/tmux-10001), the owner's processes' environment and working folders, and every other
// person's home are refused by the kernel, whatever a command says. The text checks below (a path in a working directory or a command) stay as friendly words in front of that wall, not as the wall.
// The agent's owner, a person's own Assistant and a turn acting for nobody keep the agent's home as it is. What one container still shares: the process list and command lines (`ps`), /tmp (a person's
// programs use their own TMPDIR), the memory, CPU and process caps.

/** Where the homes of the people who use the agent live: a volume of its own (workspace.ts PEOPLE_GUEST). */
export const PEOPLE_DIR = "/people";

export interface AskerPlace {
  /** The person this place is for. */
  person: string;
  /** Their Unix user id and group id in the container. */
  uid: number;
  /** Their folder: HOME for their shell. */
  home: string;
  /** What their shell starts with. */
  env: Readonly<Record<string, string>>;
}

export function askerPlace(person: string, uid: number): AskerPlace {
  const home = `${PEOPLE_DIR}/u${uid}`;
  return {
    person,
    uid,
    home,
    env: {
      HOME: home,
      HISTFILE: `${home}/.bash_history`,
      XDG_CONFIG_HOME: `${home}/.config`,
      XDG_CACHE_HOME: `${home}/.cache`,
      XDG_DATA_HOME: `${home}/.local/share`,
      XDG_STATE_HOME: `${home}/.local/state`,
      TMPDIR: `${home}/.tmp`,
    },
  };
}

/** The exit status of `ensureCommand` when the folder of this uid was made by someone else first: the uid is burned and the person gets the next. */
export const SQUATTED = 77;

/**
 * Makes the person's folder (run AS the person's uid, so it is theirs and 0700), the shell's usual start files (from /etc/skel, never over a file that is there) and the folders programs expect. A folder that is
 * there and not owned by this uid ends with SQUATTED. Safe to run again. `sh -c`, the folder and the uid passed as arguments.
 */
export function ensureCommand(p: AskerPlace): string[] {
  return [
    "sh",
    "-c",
    'h="$1"; u="$2"; umask 077; if [ -e "$h" ]; then [ "$(stat -c %u "$h")" = "$u" ] || exit 77; else mkdir -m 700 "$h" || exit 77; [ "$(stat -c %u "$h")" = "$u" ] || exit 77; fi; ' +
      'mkdir -p "$h/.config" "$h/.cache" "$h/.local/share" "$h/.local/state" "$h/.ssh" "$h/.tmp" && cp -rn /etc/skel/. "$h"/ 2>/dev/null; true',
    "sh",
    p.home,
    String(p.uid),
  ];
}

/** Takes a person's folder out of a workspace (they left the Space and the Trash time is over). Run as the person's uid: nobody else can. */
export function removeCommand(p: AskerPlace): string[] {
  return ["sh", "-c", 'rm -rf "$1"; true', "sh", p.home];
}

/** The `u<uid>` folders under /people that a path names and that are not this person's. Friendly words only: the kernel is the wall. */
export function otherFolders(text: string, uid: number): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_.-])\/people\/(u\d+)(?![A-Za-z0-9_])/g)) {
    if (m[1] !== `u${uid}`) found.add(m[1] ?? "");
  }
  return [...found];
}

/** Is `dir` (a working directory as given) in another person's folder? */
export const inOtherFolder = (dir: string, uid: number): boolean => otherFolders(dir, uid).length > 0;

/**
 * What the agent's home itself holds that a path names in the plain spelling `/home/agent/<name>`: the agent's own dotfiles, keys and tokens (the owner's sign-ins live there), `.bash_history`, and so on.
 * The Files mirror `Vyre` and the project folders are other rules; this lists the rest, and `""` for the home folder itself. Friendly words only.
 */
export function ownersHomeRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\/home\/agent(?![A-Za-z0-9_.-])(?:\/([^\s\/'"`;|&)<>]*))?/g)) {
    const seg = m[1] ?? "";
    if (seg === "projects" || seg === "Vyre") continue;
    out.push(seg);
  }
  return out;
}

/** Does a path name the Files mirror (`~/Vyre`, `$HOME/Vyre`, `/home/agent/Vyre`)? */
export const namesMirror = (text: string): boolean =>
  /(?:\/home\/agent|~|\$HOME|\$\{HOME\})\/Vyre(?![A-Za-z0-9_-])/.test(text);

/** The project folders a path names: `/home/agent/projects/<id>` or `~/projects/<id>`. */
export function projectsNamed(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\/home\/agent|~|\$HOME|\$\{HOME\})\/projects\/([A-Za-z0-9_-]+)/g))
    if (m[1]) out.add(m[1]);
  return [...out];
}
