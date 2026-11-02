// INSIDE the container: the engine's only way out. Listens on 127.0.0.1 (argv[2] gets the port) and carries each connection over the named pipe argv[3], whose DACL lets this container in.
import fs from "node:fs";
import net from "node:net";
const [portFile, pipe] = process.argv.slice(2);
const server = net.createServer((c) => {
  const up = net.connect(pipe);
  c.on("error", () => up.destroy());
  up.on("error", () => c.destroy());
  c.pipe(up);
  up.pipe(c);
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(portFile, String(server.address().port)));
setTimeout(() => process.exit(0), 20 * 60_000);
