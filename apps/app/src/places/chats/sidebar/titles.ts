// What the list shows for a chat. A chat has one name (lib/chat-name.ts), made once in rowOf: a direct message is the person, any other chat its title, and until it has one, the people in it.
// The title is made by the server after the first real request (chat.title_make), never from a greeting and never after a person renames the chat.
import type { ChatRow } from "./model.ts";

/** What the list shows for a chat: the one name the server's title and the people in it give (lib/chat-name.ts, made in rowOf). No first line of a message and no date stand in for it. */
export function displayTitle(row: Pick<ChatRow, "title">): string {
  return row.title;
}
