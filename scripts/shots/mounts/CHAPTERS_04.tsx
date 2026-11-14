// Mount for lane chat-chapters: the same chat with two people in it. The job line names nothing: "Working in the background".
import type { ReactNode } from "react";
import { Pieces } from "./CHAPTERS_02.tsx";

export const title = "Chapters, two people";

export default function Mount(): ReactNode {
  return <Pieces two />;
}
