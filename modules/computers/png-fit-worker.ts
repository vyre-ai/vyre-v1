// The worker of fitPngOffLoop (png-fit.ts): scales a screenshot to fit, off the server's event loop.
import { parentPort, workerData } from "node:worker_threads";
import { fitPng } from "./png-fit.ts";

const d = workerData as { base64: string; size: { width: number; height: number }; limit: number };
parentPort?.postMessage(fitPng(d.base64, d.size, d.limit));
