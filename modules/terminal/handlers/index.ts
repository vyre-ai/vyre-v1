// Handler table of the terminal module: all 18 capabilities of manifests/terminal.ts.
import { attach, close, get, health, input, interrupt, list, open, openServer, read, rename, request, resize, risk, rulesGet, rulesSet, run, status } from "./sessions.ts";

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
  "terminal.request": request,
  "terminal.risk": risk,
  "terminal.rules.get": rulesGet,
  "terminal.rules.set": rulesSet,
  "terminal.health": health,
};
export { isDangerCall } from "./sessions.ts";
export { fetchesOutside, outwardOf } from "../risk.ts";
