// files: roots the tree handler ensures. Rows stay empty; bytes need the Space seal, so the handler creates them.

import { KNOWLEDGE_CHILDREN, TREE_ROOTS } from "../handlers/tree.ts";

export const seed = {
  table: "files_folder",
  roots: TREE_ROOTS,
  knowledge: KNOWLEDGE_CHILDREN,
  rows: [] as { id: string; name: string; created_at: number }[],
};
