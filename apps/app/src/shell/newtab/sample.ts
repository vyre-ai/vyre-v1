// The Northwind sample for the new-tab page (shots and tests): the Cmd-K sample plus faces, folders and record types in the prototype's words.
import { LOCAL_HITS, createSampleData } from "../cmdk/sample.ts";
import type { SampleOptions } from "../cmdk/sample.ts";
import type { Hit } from "../cmdk/model.ts";
import { newTabData } from "./data.ts";
import type { NewTabData } from "./model.ts";

const folder = (id: string, title: string): Hit => ({ kind: "file", id, title, link: `vyre://folder/${id}`, score: 1, snippet: "Folder" });

export function createSampleNewTab(opts: SampleOptions = {}): { data: NewTabData; went: string[] } {
  const { data } = createSampleData(opts);
  const went: string[] = [];
  const faces = LOCAL_HITS.filter((h) => h.kind === "agent" || h.kind === "person");
  const folders = [folder("f1", "Projects/Rivera matter"), folder("f2", "Projects/Pruitt engagement"), folder("f3", "Contracts/Partners")];
  const out = newTabData(data, { go: (place, hash) => void went.push(`${place}${hash ? `#${hash}` : ""}`) }, {
    faces: () => faces,
    folders: () => folders,
    recordTypes: () => ["Agents", "Projects", "Hires", "ATP", "Contacts", "Companies", "Invoices"],
  });
  return { data: out, went };
}
