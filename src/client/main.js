import Adw from "gi://Adw?version=1";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import { ContactsView } from "./contacts-view.js";
import { EventsView } from "./events-view.js";
import { NotesView } from "./notes-view.js";
import {
  gettext as _,
  initializeLocalization,
} from "./i18n.js";
import { LocalApi } from "./local-api.js";
import { showMessage } from "./shared-ui.js";

const scriptPath = GLib.filename_from_uri(import.meta.url)[0];
const sourceDirectory = GLib.path_get_dirname(scriptPath);
const projectRoot = GLib.canonicalize_filename(
  GLib.build_filenamev([sourceDirectory, "..", ".."]),
  null,
);
const localeDirectory = GLib.build_filenamev([projectRoot, "locale"]);
const maxLogEntries = 500;

initializeLocalization(localeDirectory);
Adw.init();

class TimeManagerWindow {
  constructor(application) {
    this.api = new LocalApi(projectRoot);
    this.logEntries = [];
    this.stopped = false;
    this.api.onLog = (message, level) => this._log(message, level);
    this._log(_("Local contacts, events, and notes client started."));

    this.window = new Adw.ApplicationWindow({
      application,
      title: _("Time Manager"),
      default_width: 760,
      default_height: 640,
    });
    this.window.connect("close-request", () => {
      this._log(_("Client window closed."));
      this._stop();
      return false;
    });

    this.navigation = new Adw.NavigationView();
    this.contactsView = new ContactsView({
      api: this.api,
      window: this.window,
      navigation: this.navigation,
      log: (message, level) => this._log(message, level),
      showLog: (parentWindow) => this._showLog(parentWindow),
      refresh: (view) => this._refresh(view),
      switchToEvents: () => this._switchTo(this.eventsView),
      switchToNotes: () => this._switchTo(this.notesView),
    });
    this.eventsView = new EventsView({
      api: this.api,
      window: this.window,
      navigation: this.navigation,
      log: (message, level) => this._log(message, level),
      showLog: (parentWindow) => this._showLog(parentWindow),
      refresh: (view) => this._refresh(view),
      switchToContacts: () => this._switchTo(this.contactsView),
      switchToNotes: () => this._switchTo(this.notesView),
      addNoteToEvent: (eventKey, onCreated, parentWindow) =>
        this.notesView.createNoteForEvent(eventKey, onCreated, parentWindow),
    });
    this.notesView = new NotesView({
      api: this.api,
      window: this.window,
      navigation: this.navigation,
      log: (message, level) => this._log(message, level),
      showLog: (parentWindow) => this._showLog(parentWindow),
      refresh: (view) => this._refresh(view),
      switchToContacts: () => this._switchTo(this.contactsView),
      switchToEvents: () => this._switchTo(this.eventsView),
    });
    this.navigation.add(this.eventsView.page);
    this.navigation.add(this.contactsView.page);
    this.navigation.add(this.notesView.page);
    this.window.set_content(this.navigation);

    this.api.onUnexpectedExit = (message) => {
      this._log(_("Local API stopped unexpectedly: %s").replace("%s", message), "ERROR");
      this.api.stop();
      this._showError(message);
    };
    this.window.present();
    this._startApi();
  }

  _switchTo(view) {
    this.contactsView.cancelPendingRequests();
    this.eventsView.cancelPendingRequests();
    this.notesView.cancelPendingRequests();
    this.navigation.replace([view.page]);
    this._refresh(view);
  }

  _refresh(view) {
    if (this.api.baseUrl) view.load();
    else this._startApi();
  }

  async _startApi() {
    if (this.startingApi) return this.startingApi;
    this.startingApi = this._startApiOnce();
    try {
      await this.startingApi;
    } finally {
      this.startingApi = null;
    }
  }

  async _startApiOnce() {
    try {
      this._log(_("Starting local API."));
      await this.api.start();
      this._log(
        _("Local API ready at %s.").replace("%s", this.api.baseUrl),
      );
      const currentPage = this.navigation.visible_page;
      if (currentPage === this.eventsView.page) {
        await this.eventsView.load();
      } else if (currentPage === this.notesView.page) {
        await this.notesView.load();
      } else {
        await this.contactsView.load();
      }
    } catch (error) {
      this._log(_("Local API startup failed: %s").replace("%s", error.message), "ERROR");
      this.api.stop();
      this._showError(error.message);
    }
  }

  _log(message, level = "INFO") {
    message = String(message).replace(/\s+/g, " ").trim();
    const timestamp = GLib.DateTime.new_now_local().format(
      "%Y-%m-%d %H:%M:%S",
    );
    this.logEntries.push(`${timestamp} [${level}] ${message}`);
    if (this.logEntries.length > maxLogEntries) {
      this.logEntries.splice(0, this.logEntries.length - maxLogEntries);
    }
    if (this.logBuffer) {
      this.logBuffer.set_text(this.logEntries.join("\n"), -1);
      const end = this.logBuffer.get_end_iter();
      this.logTextView.scroll_to_iter(end, 0, false, 0, 1);
    }
  }

  _showLog(parentWindow) {
    this._log(_("Diagnostic log opened."));
    if (this.logWindow) {
      this.logWindow.present();
      return;
    }

    this.logBuffer = new Gtk.TextBuffer();
    this.logTextView = new Gtk.TextView({
      buffer: this.logBuffer,
      editable: false,
      cursor_visible: false,
      monospace: true,
      wrap_mode: Gtk.WrapMode.WORD_CHAR,
      left_margin: 12,
      right_margin: 12,
      top_margin: 12,
      bottom_margin: 12,
    });
    this.logBuffer.set_text(this.logEntries.join("\n"), -1);

    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      vexpand: true,
      child: this.logTextView,
    });
    const toolbar = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
      title_widget: new Adw.WindowTitle({ title: _("Diagnostic Log") }),
    });
    const clearButton = new Gtk.Button({ label: _("Clear Log") });
    clearButton.connect("clicked", () => {
      this.logEntries = [];
      this._log(_("Log cleared."));
    });
    headerBar.pack_start(clearButton);
    const closeButton = new Gtk.Button({ label: _("Close") });
    closeButton.connect("clicked", () => this.logWindow.close());
    headerBar.pack_end(closeButton);
    toolbar.add_top_bar(headerBar);
    toolbar.set_content(scrolled);

    this.logWindow = new Adw.Window({
      transient_for: parentWindow,
      title: _("Diagnostic Log"),
      default_width: 760,
      default_height: 480,
    });
    this.logWindow.set_content(toolbar);
    this.logWindow.connect("close-request", () => {
      this.logWindow = null;
      this.logTextView = null;
      this.logBuffer = null;
      return false;
    });
    this.logWindow.present();
  }

  _showError(message) {
    const visiblePage = this.navigation.visible_page;
    if (visiblePage === this.eventsView.page) {
      this.eventsView.showError(message);
    } else if (visiblePage === this.contactsView.page) {
      this.contactsView.showError(message);
    } else if (visiblePage === this.notesView.page) {
      this.notesView.showError(message);
    } else {
      showMessage(this.window, _("Local API error"), message);
    }
  }

  _stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.contactsView.dispose();
    this.eventsView.dispose();
    this.notesView.dispose();
    this.api.stop();
  }
}

const application = new Adw.Application({
  application_id: "io.github.jostaaf.TimeManager",
  flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});
let mainWindow = null;

application.connect("activate", (app) => {
  if (!mainWindow) mainWindow = new TimeManagerWindow(app);
  else mainWindow.window.present();
});
application.connect("shutdown", () => mainWindow?._stop());
application.run([]);
