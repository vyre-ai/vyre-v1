const http = require("node:http");
http.createServer((req, res) => res.end(req.url === "/health" ? "ok" : "railway-fixture-ok")).listen(Number(process.env.PORT), "0.0.0.0");
