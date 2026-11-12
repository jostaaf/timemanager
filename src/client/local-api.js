import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";
import { gettext as _ } from "./i18n.js";

const decoder = new TextDecoder();

const apiErrorMessages = {
  method_not_allowed: _("Method not allowed"),
  not_found: _("API route not found"),
  contact_not_found: _("Contact not found"),
  social_not_found: _("Contact or social record not found"),
  contact_conflict: _("Contact version conflict"),
  social_conflict: _("Contact or social version conflict"),
  event_not_found: _("Event not found"),
  event_conflict: _("Event version conflict"),
  event_contact_not_found: _("Event contact assignment not found"),
  duplicate_contact: _("A contact can only be assigned to an event once"),
  note_not_found: _("Note not found"),
  note_conflict: _("Note version conflict"),
  duplicate_note_contact: _("A contact can only be assigned to a note once"),
  duplicate_note_event: _("An event can only be assigned to a note once"),
  constraint_violation: _(
    "The record conflicts with existing data",
  ),
};

export class LocalApi {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.session = new Soup.Session();
    this.process = null;
    this.baseUrl = null;
    this.token = null;
    this.stderr = "";
    this.stopping = false;
  }

  start() {
    this.stopping = false;
    this.stderr = "";
    const node = GLib.find_program_in_path("node");
    if (!node) {
      return Promise.reject(
        new Error(_("Node.js is required to start the local API.")),
      );
    }

    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDIN_PIPE |
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE,
    });
    launcher.set_cwd(this.projectRoot);
    launcher.setenv("TIMEMANAGER_API_PORT", "0", true);
    launcher.setenv("TIMEMANAGER_API_CONTROL_PIPE", "1", true);
    const serverPath = GLib.build_filenamev([
      this.projectRoot,
      "dist",
      "server",
      "http",
      "main.js",
    ]);

    try {
      this.process = launcher.spawnv([node, serverPath]);
    } catch (error) {
      return Promise.reject(
        new Error(
          _("Could not start the local API: %s").replace("%s", error.message),
        ),
      );
    }

    this._readStderr();
    this.process.wait_async(null, (subprocess, result) => {
      try {
        subprocess.wait_finish(result);
        if (!this.stopping && this.baseUrl) {
          this.onUnexpectedExit?.(
            this.stderr.trim() || _("The local API stopped unexpectedly."),
          );
        }
      } catch (error) {
        if (!this.stopping) this.onUnexpectedExit?.(error.message);
      }
    });

    return new Promise((resolve, reject) => {
      const output = new Gio.DataInputStream({
        base_stream: this.process.get_stdout_pipe(),
      });
      output.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
        try {
          const [line] = stream.read_line_finish(result);
          if (!line) {
            reject(new Error(
              this.stderr.trim() || _("The local API exited before it was ready."),
            ));
            return;
          }
          const startup = JSON.parse(decoder.decode(line));
          const address = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(
            startup.address,
          );
          const port = address ? Number(address[1]) : 0;
          if (
            !address ||
            port < 1 ||
            port > 65535 ||
            typeof startup.token !== "string" ||
            startup.token.length < 32
          ) {
            throw new Error(_("The local API returned invalid startup details."));
          }
          this.baseUrl = startup.address;
          this.token = startup.token;
          resolve();
        } catch (error) {
          reject(new Error(
            _("Could not initialize the local API: %s").replace(
              "%s",
              error.message,
            ),
          ));
          this.stop();
        }
      });
    });
  }

  _readStderr() {
    const stream = new Gio.DataInputStream({
      base_stream: this.process.get_stderr_pipe(),
    });
    const readNextLine = () => {
      stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
          const [line] = source.read_line_finish(result);
          if (!line) return;
          if (this.stderr.length < 4096) {
            this.stderr += `${decoder.decode(line)}\n`;
          }
          readNextLine();
        } catch (error) {
          if (!this.stopping) {
            this.stderr += _("Could not read API diagnostics: %s").replace(
              "%s",
              error.message,
            );
          }
        }
      });
    };
    readNextLine();
  }

  getContacts(searchText = "") {
    const query = searchText.trim();
    const path = `/api/contacts${
      query ? `?name=${encodeURIComponent(query)}` : ""
    }`;
    return this._request("GET", path).then((payload) => {
      if (!Array.isArray(payload?.contacts)) {
        throw new Error(_("The API returned an invalid contacts response."));
      }
      return payload.contacts;
    });
  }

  getContact(contactKey) {
    return this._request("GET", `/api/contacts/${contactKey}`);
  }

  createContact(contact) {
    return this._request("POST", "/api/contacts", contact);
  }

  updateContact(contactKey, input) {
    return this._request("PATCH", `/api/contacts/${contactKey}`, input);
  }

  deleteContact(contactKey, expectedVersion) {
    return this._request("DELETE", `/api/contacts/${contactKey}`, {
      expectedVersion,
    });
  }

  getEvents(searchText = "") {
    const query = searchText.trim();
    const path = `/api/events${query ? `?name=${encodeURIComponent(query)}` : ""}`;
    return this._request("GET", path).then((payload) => {
      if (!Array.isArray(payload?.events)) {
        throw new Error(_("The API returned an invalid events response."));
      }
      return payload.events;
    });
  }

  getEvent(eventKey) {
    return this._request("GET", `/api/events/${eventKey}`);
  }

  createEvent(event) {
    return this._request("POST", "/api/events", event);
  }

  updateEvent(eventKey, input) {
    return this._request("PATCH", `/api/events/${eventKey}`, input);
  }

  deleteEvent(eventKey, expectedVersion) {
    return this._request("DELETE", `/api/events/${eventKey}`, {
      expectedVersion,
    });
  }

  getNotes(searchText = "") {
    const query = searchText.trim();
    const path = `/api/notes${query ? `?q=${encodeURIComponent(query)}` : ""}`;
    return this._getNotes(path);
  }

  getNotesForEvent(eventKey) {
    const path = `/api/notes?eventKey=${encodeURIComponent(eventKey)}`;
    return this._getNotes(path);
  }

  _getNotes(path) {
    return this._request("GET", path).then((payload) => {
      if (!Array.isArray(payload?.notes)) {
        throw new Error(_("The API returned an invalid notes response."));
      }
      return payload.notes;
    });
  }

  getNote(noteKey) {
    return this._request("GET", `/api/notes/${noteKey}`);
  }

  createNote(note) {
    return this._request("POST", "/api/notes", note);
  }

  updateNote(noteKey, input) {
    return this._request("PATCH", `/api/notes/${noteKey}`, input);
  }

  deleteNote(noteKey, expectedVersion) {
    return this._request("DELETE", `/api/notes/${noteKey}`, {
      expectedVersion,
    });
  }

  _request(method, path, body = undefined) {
    if (!this.baseUrl || !this.token) {
      return Promise.reject(new Error(_("The local API is not ready.")));
    }

    const route = path.split("?")[0];
    this.onLog?.(_("HTTP %s %s started.").replace("%s", method).replace("%s", route));
    return new Promise((resolve, reject) => {
      const message = Soup.Message.new(method, `${this.baseUrl}${path}`);
      message.request_headers.append("Authorization", `Bearer ${this.token}`);
      if (body !== undefined) {
        message.set_request_body_from_bytes(
          "application/json",
          new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))),
        );
      }
      this.session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        null,
        (session, result) => {
          try {
            const bytes = session.send_and_read_finish(result);
            const text = decoder.decode(bytes.get_data());
            this.onLog?.(
              _("HTTP %s %s returned status %d.")
                .replace("%s", method)
                .replace("%s", route)
                .replace("%d", String(message.status_code)),
              message.status_code >= 400 ? "ERROR" : "INFO",
            );
            let payload;
            try {
              payload = JSON.parse(text);
            } catch {
              throw new Error(_("The API returned invalid JSON."));
            }
            if (message.status_code < 200 || message.status_code >= 300) {
              const apiError = payload.error;
              this.onLog?.(
                _("API error code: %s").replace(
                  "%s",
                  apiError?.code ?? _("unknown"),
                ),
                "ERROR",
              );
              if (apiError?.message) {
                this.onLog?.(
                  _("API error message: %s").replace("%s", apiError.message),
                  "ERROR",
                );
              }
              throw new Error(
                apiErrorMessages[apiError?.code] ??
                  apiError?.message ??
                  _("API request failed (%d).").replace(
                    "%d",
                    String(message.status_code),
                  ),
              );
            }
            resolve(payload);
          } catch (error) {
            this.onLog?.(
              _("HTTP %s %s failed: %s")
                .replace("%s", method)
                .replace("%s", route)
                .replace("%s", error.message),
              "ERROR",
            );
            reject(new Error(
              _("API request failed: %s").replace("%s", error.message),
            ));
          }
        },
      );
    });
  }

  stop() {
    this.stopping = true;
    this.session.abort();
    if (this.process) {
      const input = this.process.get_stdin_pipe();
      if (input && !input.is_closed()) input.close(null);
    }
    this.process = null;
    this.baseUrl = null;
    this.token = null;
  }
}
