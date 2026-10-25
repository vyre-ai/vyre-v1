// Props for ui/Avatar: the one face for a person, an agent, the assistant, an automation or a group, at any size.
// People get a marble seeded by their name until they add a photo; agents get a pixel face seeded by their name; the assistant is the Vyre mark.

export type AvatarKind = "person" | "agent" | "assistant" | "automation" | "group";

export interface AvatarProps {
  /** The name the face is seeded from. The same name draws the same face everywhere. */
  name: string;
  kind?: AvatarKind;
  /** Edge in px. Defaults to 18, the size of a list row face. */
  size?: number;
  /** A photo replaces the person's marble. */
  photo?: string;
  /** A small green dot at the bottom right: this agent is running right now. */
  running?: boolean;
  /** A small green dot at the bottom left: this person is here. */
  present?: boolean;
  testID?: string;
}
