import { randomBytes } from "node:crypto";
import { db } from "../db/client.js";
import { startApiServer } from "./server.js";

const token = randomBytes(32).toString("base64url");
const portValue = process.env.TIMEMANAGER_API_PORT ?? "0";
if (!/^(0|[1-9]\d*)$/.test(portValue)) {
  throw new TypeError("TIMEMANAGER_API_PORT must be a valid port number");
}
const port = Number(portValue);
if (!Number.isInteger(port) || port > 65535) {
  throw new RangeError("TIMEMANAGER_API_PORT must be between 0 and 65535");
}

const server = await startApiServer(token, port);
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Could not determine API server address");
}
process.stdout.write(`${JSON.stringify({
  address: `http://127.0.0.1:${address.port}`,
  token,
})}\n`);

let stopping = false;
function stopServer(): void {
  if (stopping) return;
  stopping = true;
  server.close((error) => {
    if (error) {
      console.error("Could not stop API server cleanly", error);
      process.exitCode = 1;
    }
    db.close();
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, stopServer);
}
if (process.env.TIMEMANAGER_API_CONTROL_PIPE === "1") {
  process.stdin.once("end", stopServer);
  process.stdin.resume();
}
