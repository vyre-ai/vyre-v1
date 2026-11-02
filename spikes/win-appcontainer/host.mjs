// Outside the container: a TCP server on the host's loopback and a Node pipe server (default security), each answering "hi". Writes the port to argv[2].
import fs from "node:fs";
import net from "node:net";
const s = net.createServer((c) => c.end("hi")).listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(s.address().port)));
net.createServer((c) => c.end("hi")).listen("\\\\.\\pipe\\vyre-spike-node");
setTimeout(() => process.exit(0), 10 * 60_000);
