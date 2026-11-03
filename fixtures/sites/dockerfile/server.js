require("node:http").createServer((req, res) => res.end(`dockerfile-fixture-ok ${process.env.VERSION_TAG ?? "v1"}`)).listen(8080, "0.0.0.0");
