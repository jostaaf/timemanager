import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { handleContactsApiRequest, type ApiResponse } from "../api/contacts.js";
import { handleEventsApiRequest } from "../api/events.js";
import { handleNotesApiRequest } from "../api/notes.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

function sendJson(response: ServerResponse, result: ApiResponse): void {
  response.statusCode = result.status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(result.body));
}

function unauthorized(response: ServerResponse): void {
  sendJson(response, {
    status: 401,
    body: {
      error: {
        code: "unauthorized",
        message: "A valid bearer token is required",
      },
    },
  });
}

function hasValidToken(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new RangeError("Request body exceeds the 1 MiB limit");
    }
    chunks.push(buffer);
  }
  if (totalBytes === 0) {
    throw new SyntaxError("A JSON request body is required");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new SyntaxError("Request body must contain valid JSON");
  }
}

function requestError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, {
    status,
    body: { error: { code: "invalid_request", message } },
  });
}

function createApiServer(token: string): Server {
  if (token.length < 32) {
    throw new TypeError("API bearer token must contain at least 32 characters");
  }

  return createServer(async (request, response) => {
    try {
      if (!hasValidToken(request, token)) {
        unauthorized(response);
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const hasBody = request.method === "POST" || request.method === "PATCH" ||
        request.method === "DELETE";
      let body: unknown;
      if (hasBody) {
        try {
          const contentType = request.headers["content-type"]?.split(";")[0]?.trim();
          if (contentType !== "application/json") {
            requestError(response, 415, "Content-Type must be application/json");
            return;
          }
          body = await readJsonBody(request);
        } catch (error) {
          if (error instanceof RangeError) {
            requestError(response, 413, error.message);
          } else if (error instanceof SyntaxError) {
            requestError(response, 400, error.message);
          } else {
            throw error;
          }
          return;
        }
      }

      const handleRequest = url.pathname.startsWith("/api/events")
        ? handleEventsApiRequest
        : url.pathname.startsWith("/api/notes")
          ? handleNotesApiRequest
          : handleContactsApiRequest;
      sendJson(response, handleRequest(request.method ?? "GET", url, body));
    } catch (error) {
      console.error("API request failed", error);
      sendJson(response, {
        status: 500,
        body: {
          error: {
            code: "internal_error",
            message: "The request could not be completed",
          },
        },
      });
    }

  });
}

export function startApiServer(token: string, port = 0): Promise<Server> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError("API port must be between 0 and 65535");
  }
  const server = createApiServer(token);
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}
