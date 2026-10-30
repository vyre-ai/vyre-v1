// Handler table of the memory module: all 31 capabilities of manifests/memory.ts. The module's `status` in host/modules.json is flipped by the lane's live packet (ruling 25),
// after the generated contract tests pass against these handlers.
import {
  capture, counts, erase, factAccept, factCorrect, factGet, factReject, factsAsOf, factsList, factsRemove, findBySubject, layersList, mapGet, notesList, pointer, promote,
  promotionApprove, promotionReject, promotionUndo, proposeFact, readNote, restoreVersion, search, versions,
} from "./facts.ts";
import { graph, graphEverything, graphExport, indexGraph, layoutGet, layoutSave } from "./graph.ts";
import { archiveSweep, learned, restore, trailRead, trashSearch, undo } from "./lifecycle.ts";
import { backlinks, exportMarkdown, pageDelete, pageGet, pageList, pagePut, pageRestoreVersion, pageSetVisibility, pageVersions } from "./pages.ts";
import { noteErase } from "./purge.ts";
import { meaningRank, meaningStatusRead } from "./meaning.ts";
import { maintain, questionResolve, questionsList, upkeepStatus } from "./upkeep.ts";
import { keyResolve, keySet, keysGet } from "./keys.ts";
import { quote } from "./quotes.ts";
import { recallRecord, used } from "./recalllog.ts";
import { forget, remember } from "./tools.ts";

export const handlers = {
  "memory.search": search,
  "memory.read_note": readNote,
  "memory.facts_as_of": factsAsOf,
  "memory.facts.list": factsList,
  "memory.fact.get": factGet,
  "memory.notes.list": notesList,
  "memory.layers.list": layersList,
  "memory.counts": counts,
  "memory.map.get": mapGet,
  "memory.pointer": pointer,
  "memory.propose_fact": proposeFact,
  "memory.fact.accept": factAccept,
  "memory.fact.reject": factReject,
  "memory.fact.correct": factCorrect,
  "memory.facts.remove": factsRemove,
  "memory.erase": erase,
  "memory.promote": promote,
  "memory.promotion.approve": promotionApprove,
  "memory.promotion.reject": promotionReject,
  "memory.promotion.undo": promotionUndo,
  "memory.capture": capture,
  "memory.maintain": maintain,
  "memory.index_graph": indexGraph,
  "memory.graph": graph,
  "memory.graph_everything": graphEverything,
  "memory.graph_export": graphExport,
  "memory.layout.get": layoutGet,
  "memory.layout.save": layoutSave,
  "memory.versions": versions,
  "memory.restore_version": restoreVersion,
  "memory.find_by_subject": findBySubject,
  "memory.notes.erase": noteErase,
  "memory.learned": learned,
  "memory.undo": undo,
  "memory.restore": restore,
  "memory.trash.search": trashSearch,
  "memory.archive_sweep": archiveSweep,
  "memory.trail": trailRead,
  "memory.upkeep.status": upkeepStatus,
  "memory.meaning.status": meaningStatusRead,
  "memory.meaning.rank": meaningRank,
  "memory.page.get": pageGet,
  "memory.page.put": pagePut,
  "memory.page.list": pageList,
  "memory.page.versions": pageVersions,
  "memory.page.restore_version": pageRestoreVersion,
  "memory.page.delete": pageDelete,
  "memory.page.set_visibility": pageSetVisibility,
  "memory.backlinks": backlinks,
  "memory.export_markdown": exportMarkdown,
  "memory.questions.list": questionsList,
  "memory.question.resolve": questionResolve,
  "memory.quote": quote,
  "memory.used": used,
  "memory.recall.record": recallRecord,
  "memory.keys.get": keysGet,
  "memory.key.set": keySet,
  "memory.key.resolve": keyResolve,
  "memory.remember": remember,
  "memory.forget": forget,
};
