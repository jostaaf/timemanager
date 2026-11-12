import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import { gettext as _, ngettext } from "./i18n.js";
import {
  collectNoteAssignments,
  collectNoteValues,
  formatLocalDateTime,
} from "./form-model.js";
import {
  iconButton,
  logMenuButton,
  newToolbarPage,
  showMessage,
  statusPage,
} from "./shared-ui.js";

export class NotesView {
  constructor({
    api,
    window,
    navigation,
    log,
    showLog,
    refresh,
    switchToContacts,
    switchToEvents,
  }) {
    this.api = api;
    this.window = window;
    this.navigation = navigation;
    this.log = log;
    this.showLog = showLog;
    this.refresh = refresh;
    this.switchToContacts = switchToContacts;
    this.switchToEvents = switchToEvents;
    this.requestNumber = 0;
    this.searchTimeout = 0;
    this.page = this._buildListPage();
  }

  _buildListPage() {
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 12,
      margin_bottom: 12,
      margin_start: 12,
      margin_end: 12,
    });
    this.searchEntry = new Gtk.SearchEntry({
      placeholder_text: _("Search notes"),
      hexpand: true,
    });
    this.searchEntry.connect("search-changed", () => this._scheduleSearch());
    content.append(this.searchEntry);

    this.stack = new Gtk.Stack({
      vexpand: true,
      transition_type: Gtk.StackTransitionType.CROSSFADE,
    });
    this.loadingPage = statusPage(
      _("Loading notes"),
      _("Retrieving your notes..."),
      "content-loading-symbolic",
    );
    this.emptyPage = statusPage(
      _("No notes found"),
      _("Try another search or add your first note."),
      "document-new-symbolic",
    );
    this.errorPage = statusPage(
      _("Couldn't load notes"),
      _("Check the local service and try again."),
      "dialog-error-symbolic",
    );
    this.stack.add_named(this.loadingPage, "loading");
    this.stack.add_named(this.emptyPage, "empty");
    this.stack.add_named(this.errorPage, "error");
    this.listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      show_separators: true,
    });
    this.listBox.add_css_class("boxed-list");
    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vexpand: true,
      child: this.listBox,
    });
    this.stack.add_named(scrolled, "notes");
    content.append(this.stack);

    return newToolbarPage(_("Notes"), content, (headerBar) => {
      const contactsButton = new Gtk.Button({ label: _("Contacts") });
      contactsButton.connect("clicked", this.switchToContacts);
      headerBar.pack_start(contactsButton);
      const eventsButton = new Gtk.Button({ label: _("Events") });
      eventsButton.connect("clicked", this.switchToEvents);
      headerBar.pack_start(eventsButton);

      const refreshButton = iconButton(
        "view-refresh-symbolic",
        _("Refresh notes"),
      );
      refreshButton.connect("clicked", () => this.refresh(this));
      headerBar.pack_end(refreshButton);
      const addButton = new Gtk.Button({
        label: _("New"),
        icon_name: "list-add-symbolic",
      });
      addButton.add_css_class("suggested-action");
      addButton.connect("clicked", () => this._openForm());
      headerBar.pack_end(addButton);
      headerBar.pack_end(logMenuButton(this.window, this.showLog));
    });
  }

  _scheduleSearch() {
    if (this.searchTimeout) GLib.source_remove(this.searchTimeout);
    this.searchTimeout = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      250,
      () => {
        this.searchTimeout = 0;
        this.load();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  async load() {
    const requestNumber = ++this.requestNumber;
    this.stack.set_visible_child_name("loading");
    this.log(_("Loading notes."));
    try {
      const notes = await this.api.getNotes(this.searchEntry.text);
      if (requestNumber !== this.requestNumber) return;
      this._replaceNotes(notes);
      this.stack.set_visible_child_name(notes.length ? "notes" : "empty");
      this.log(
        ngettext("%d note loaded.", "%d notes loaded.", notes.length)
          .replace("%d", String(notes.length)),
      );
    } catch (error) {
      this.log(_("Loading notes failed: %s").replace("%s", error.message), "ERROR");
      if (requestNumber === this.requestNumber) this.showError(error.message);
    }
  }

  _replaceNotes(notes) {
    let child = this.listBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this.listBox.remove(child);
      child = next;
    }
    for (const note of notes) {
      const text = note.text.replace(/\s+/g, " ").trim();
      const row = new Adw.ActionRow({
        title: note.heading,
        subtitle: `${this._formatDate(note.created_at)} · ${
          text.length > 120 ? `${text.slice(0, 117)}…` : text
        }`,
        activatable: true,
      });
      row.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic" }));
      row.connect("activated", () => this._showNote(note.key));
      this.listBox.append(row);
    }
  }

  _formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  async _showNote(noteKey) {
    if (this.searchTimeout) GLib.source_remove(this.searchTimeout);
    this.searchTimeout = 0;
    const requestNumber = ++this.requestNumber;
    const sourcePage = this.navigation.visible_page;
    try {
      const result = await this.api.getNote(noteKey);
      if (
        requestNumber !== this.requestNumber ||
        this.navigation.visible_page !== sourcePage
      ) return;
      this._replaceDetailPage(result);
      this.log(_("Note details loaded (key %d).").replace(
        "%d",
        String(noteKey),
      ));
    } catch (error) {
      if (
        requestNumber === this.requestNumber &&
        this.navigation.visible_page === sourcePage
      ) {
        this.log(_("Loading note details failed: %s").replace("%s", error.message), "ERROR");
        showMessage(this.window, _("Couldn't load note"), error.message);
      }
    }
  }

  _buildDetailPage(result) {
    const { note, contacts, events } = result;
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      margin_top: 12,
      margin_bottom: 18,
      margin_start: 12,
      margin_end: 12,
    });
    const details = new Adw.PreferencesGroup({ title: _("Note details") });
    details.add(new Adw.ActionRow({
      title: _("Created"),
      subtitle: this._formatDate(note.created_at),
    }));
    const textView = new Gtk.TextView({
      editable: false,
      cursor_visible: false,
      wrap_mode: Gtk.WrapMode.WORD_CHAR,
      left_margin: 12,
      right_margin: 12,
      top_margin: 12,
      bottom_margin: 12,
    });
    textView.buffer.set_text(note.text, -1);
    const textFrame = new Gtk.Frame({ child: textView });
    const textScroll = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      min_content_height: 120,
      child: textFrame,
    });
    details.add(textScroll);
    content.append(details);

    const contactGroup = new Adw.PreferencesGroup({
      title: _("Assigned contacts"),
    });
    if (contacts.length) {
      for (const contact of contacts) {
        contactGroup.add(new Adw.ActionRow({
          title: contact.name,
          subtitle: [contact.city, contact.email].filter(Boolean).join(" · "),
        }));
      }
    } else {
      contactGroup.add(new Adw.ActionRow({ title: _("No assigned contacts") }));
    }
    content.append(contactGroup);

    const eventGroup = new Adw.PreferencesGroup({
      title: _("Assigned events"),
    });
    if (events.length) {
      for (const event of events) {
        eventGroup.add(new Adw.ActionRow({
          title: event.name,
          subtitle: `${formatLocalDateTime(event.start)} – ${
            formatLocalDateTime(event.end)
          }`,
        }));
      }
    } else {
      eventGroup.add(new Adw.ActionRow({ title: _("No assigned events") }));
    }
    content.append(eventGroup);

    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vexpand: true,
      child: content,
    });
    return newToolbarPage(note.heading, scrolled, (headerBar) => {
      const contactsButton = new Gtk.Button({ label: _("Contacts") });
      contactsButton.connect("clicked", this.switchToContacts);
      headerBar.pack_start(contactsButton);
      const eventsButton = new Gtk.Button({ label: _("Events") });
      eventsButton.connect("clicked", this.switchToEvents);
      headerBar.pack_start(eventsButton);

      const editButton = new Gtk.Button({ label: _("Edit") });
      editButton.connect("clicked", () => this._openForm(result));
      headerBar.pack_end(editButton);
      const deleteButton = iconButton("user-trash-symbolic", _("Delete note"));
      deleteButton.add_css_class("destructive-action");
      deleteButton.connect("clicked", () => this._confirmDelete(result));
      headerBar.pack_end(deleteButton);
      headerBar.pack_end(logMenuButton(this.window, this.showLog));
    });
  }

  _replaceDetailPage(result) {
    this.navigation.replace([this.page, this._buildDetailPage(result)]);
  }

  createNoteForEvent(eventKey, onCreated, parentWindow = null) {
    return this._openForm(null, { eventKey, onCreated, parentWindow });
  }

  async _openForm(
    result = null,
    { eventKey = null, onCreated = null, parentWindow = null } = {},
  ) {
    const transientFor = parentWindow ?? this.window;
    let contacts;
    let events;
    try {
      [contacts, events] = await Promise.all([
        this.api.getContacts(),
        this.api.getEvents(),
      ]);
    } catch (error) {
      showMessage(transientFor, _("Couldn't load assignments"), error.message);
      return;
    }

    const isEditing = result !== null;
    const originalNote = result?.note ?? null;
    const selectedContacts = new Set(
      (result?.contacts ?? []).map((contact) => contact.key),
    );
    const selectedEvents = new Set(
      (result?.events ?? []).map((event) => event.key),
    );
    if (!isEditing && eventKey !== null) selectedEvents.add(eventKey);
    const formWindow = new Adw.Window({
      transient_for: transientFor,
      modal: true,
      title: isEditing ? _("Edit note") : _("New note"),
      default_width: 560,
      default_height: 720,
    });
    const toolbar = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
      title_widget: new Adw.WindowTitle({
        title: isEditing ? _("Edit note") : _("New note"),
      }),
    });
    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.connect("clicked", () => formWindow.close());
    headerBar.pack_start(cancelButton);
    const saveButton = new Gtk.Button({ label: _("Save") });
    saveButton.add_css_class("suggested-action");
    headerBar.pack_end(saveButton);
    headerBar.pack_end(logMenuButton(formWindow, this.showLog));
    toolbar.add_top_bar(headerBar);

    const form = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      margin_top: 12,
      margin_bottom: 18,
      margin_start: 12,
      margin_end: 12,
    });
    const errorLabel = new Gtk.Label({
      xalign: 0,
      wrap: true,
      visible: false,
    });
    errorLabel.add_css_class("error");
    form.append(errorLabel);

    const fields = {};
    const noteGroup = new Adw.PreferencesGroup({ title: _("Note details") });
    const heading = new Adw.EntryRow({
      title: `${_("Heading")} (${_("required")})`,
    });
    heading.text = originalNote?.heading ?? "";
    noteGroup.add(heading);
    fields.heading = heading;

    const bodyLabel = new Gtk.Label({
      label: `${_("Text")} (${_("required")})`,
      xalign: 0,
    });
    noteGroup.add(bodyLabel);
    const textView = new Gtk.TextView({
      wrap_mode: Gtk.WrapMode.WORD_CHAR,
      left_margin: 12,
      right_margin: 12,
      top_margin: 12,
      bottom_margin: 12,
    });
    textView.buffer.set_text(originalNote?.text ?? "", -1);
    const textFrame = new Gtk.Frame({ child: textView });
    const textScroll = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      min_content_height: 180,
      child: textFrame,
    });
    noteGroup.add(textScroll);
    fields.text = textView.buffer;
    form.append(noteGroup);
    form.append(new Gtk.Label({
      label: eventKey === null
        ? _("Leave both assignment lists unselected to create a standalone note.")
        : _("This note will be linked to this event."),
      xalign: 0,
      wrap: true,
    }));

    const contactGroup = new Adw.PreferencesGroup({
      title: _("Contacts (optional)"),
    });
    const contactRows = contacts.map((item) => {
      const contact = item.contact;
      const row = new Adw.ActionRow({
        title: contact.name,
        subtitle: [contact.city, contact.email].filter(Boolean).join(" · "),
      });
      const selected = new Gtk.CheckButton({
        active: selectedContacts.has(contact.key),
        valign: Gtk.Align.CENTER,
      });
      row.add_suffix(selected);
      contactGroup.add(row);
      return { contact, selected };
    });
    if (contactRows.length === 0) {
      contactGroup.add(new Adw.ActionRow({ title: _("No contacts available") }));
    }
    form.append(contactGroup);

    const eventGroup = new Adw.PreferencesGroup({
      title: _("Events (optional)"),
    });
    const eventRows = events.map((event) => {
      const row = new Adw.ActionRow({
        title: event.name,
        subtitle: formatLocalDateTime(event.start),
      });
      const selected = new Gtk.CheckButton({
        active: selectedEvents.has(event.key),
        sensitive: isEditing || eventKey !== event.key,
        valign: Gtk.Align.CENTER,
      });
      row.add_suffix(selected);
      eventGroup.add(row);
      return { event, selected };
    });
    if (eventRows.length === 0) {
      eventGroup.add(new Adw.ActionRow({ title: _("No events available") }));
    }
    form.append(eventGroup);

    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vexpand: true,
      child: form,
    });
    toolbar.set_content(scrolled);
    formWindow.set_content(toolbar);
    saveButton.connect("clicked", () => {
      saveButton.sensitive = false;
      saveButton.label = _("Saving...");
      errorLabel.visible = false;
      this._saveForm({
        isEditing,
        originalNote,
        contactRows,
        eventRows,
        fields,
        result,
        formWindow,
        onCreated,
        messageParent: transientFor,
      }).catch((error) => {
        this.log(_("Note save failed: %s").replace("%s", error.message), "ERROR");
        errorLabel.label = error.message;
        errorLabel.visible = true;
        scrolled.vadjustment.value = 0;
        saveButton.label = _("Save");
        saveButton.sensitive = true;
      });
    });
    formWindow.present();
  }

  async _saveForm({
    isEditing,
    originalNote,
    contactRows,
    eventRows,
    fields,
    result,
    formWindow,
    onCreated,
    messageParent,
  }) {
    const textBounds = fields.text.get_bounds();
    const text = fields.text.get_text(textBounds[0], textBounds[1], true);
    const note = collectNoteValues(
      { heading: fields.heading.text, text },
      _,
    );
    const assignments = collectNoteAssignments(
      contactRows.map((row) => ({
        contact: row.contact,
        selected: row.selected.active,
      })),
      eventRows.map((row) => ({
        event: row.event,
        selected: row.selected.active,
      })),
    );
    let saved;
    let persisted = false;
    if (isEditing) {
      const changes = {};
      for (const field of ["heading", "text"]) {
        if (note[field] !== originalNote[field]) changes[field] = note[field];
      }
      const currentContactKeys = [...(result.contacts ?? [])]
        .map((contact) => contact.key)
        .sort((left, right) => left - right);
      const currentEventKeys = [...(result.events ?? [])]
        .map((event) => event.key)
        .sort((left, right) => left - right);
      const contactKeys = [...assignments.contactKeys]
        .sort((left, right) => left - right);
      const eventKeys = [...assignments.eventKeys]
        .sort((left, right) => left - right);
      const assignmentsChanged =
        contactKeys.join(",") !== currentContactKeys.join(",") ||
        eventKeys.join(",") !== currentEventKeys.join(",");
      if (Object.keys(changes).length || assignmentsChanged) {
        saved = await this.api.updateNote(originalNote.key, {
          expectedVersion: originalNote.version,
          changes,
          contactKeys,
          eventKeys,
        });
        persisted = true;
      } else {
        saved = result;
      }
    } else {
      saved = await this.api.createNote({
        ...note,
        ...assignments,
      });
      persisted = true;
    }

    formWindow.close();
    if (!isEditing) {
      this.searchEntry.text = "";
      if (this.searchTimeout) GLib.source_remove(this.searchTimeout);
      this.searchTimeout = 0;
    }
    await this.load();
    if (isEditing) this._replaceDetailPage(saved);
    else if (onCreated) await onCreated(saved);
    else await this._showNote(saved.note.key);
    if (persisted) {
      showMessage(
        messageParent,
        _("Note saved"),
        _("%s has been saved to the database.").replace("%s", saved.note.heading),
      );
    }
  }

  _confirmDelete(result) {
    const dialog = new Adw.MessageDialog({
      transient_for: this.window,
      heading: _("Delete note?"),
      body: _("Delete “%s”? Contact and event records will not be deleted.")
        .replace("%s", result.note.heading),
    });
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("delete", _("Delete"));
    dialog.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response("cancel");
    dialog.set_close_response("cancel");
    dialog.connect("response", async (_dialog, response) => {
      if (response !== "delete") return;
      try {
        await this.api.deleteNote(result.note.key, result.note.version);
        this.navigation.pop();
        await this.load();
      } catch (error) {
        showMessage(this.window, _("Couldn't delete note"), error.message);
      }
    });
    dialog.present();
  }

  showError(message) {
    this.errorPage.description = message;
    this.stack.set_visible_child_name("error");
  }

  dispose() {
    if (this.searchTimeout) GLib.source_remove(this.searchTimeout);
    this.searchTimeout = 0;
  }

  cancelPendingRequests() {
    this.requestNumber++;
  }
}
