// Handler table of the terminal module: all 16 capabilities of manifests/terminal.ts.
import { attach, close, get, health, input, interrupt, list, open, openServer, read, rename, resize, rulesGet, rulesSet, run, status } from "./sessions.ts";

export const handlers = {
  "terminal.list": list,
  "terminal.get": get,
  "terminal.status": status,
  "terminal.open": open,
  "terminal.open_server": openServer,
  "terminal.rename": rename,
  "terminal.close": close,
  "terminal.input": input,
  "terminal.interrupt": interrupt,
  "terminal.resize": resize,
  "terminal.read": read,
  "terminal.attach": attach,
  "terminal.run": run,
  "terminal.rules.get": rulesGet,
  "terminal.rules.set": rulesSet,
  "terminal.health": health,
};
