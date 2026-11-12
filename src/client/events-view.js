import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import { gettext as _, ngettext } from "./i18n.js";
import {
  collectEventContactChanges,
  collectEventValues,
  formatLocalDateTime,
  shouldShowEventContactAssignment,
  toLocalDateInput,
  toLocalTimeInput,
} from "./form-model.js";
import {
  addDetailRow,
  iconButton,
  logMenuButton,
  newToolbarPage,
  showMessage,
  statusPage,
} from "./shared-ui.js";

const eventFields = [
  ["name", _("Name"), true],
  ["startDate", _("Start date (YYYY-MM-DD)"), true],
  ["startTime", _("Start time (HH:MM)"), true],
  ["endDate", _("End date (YYYY-MM-DD)"), true],
  ["endTime", _("End time (HH:MM)"), true],
  ["comment", _("Comment"), false],
];

export class EventsView {
  constructor({
    api,
    window,
    navigation,
    log,
    showLog,
    refresh,
    switchToContacts,
    switchToNotes,
    addNoteToEvent,
  }) {
    this.api = api;
    this.window = window;
    this.navigation = navigation;
    this.log = log;
    this.showLog = showLog;
    this.refresh = refresh;
    this.switchToContacts = switchToContacts;
    this.switchToNotes = switchToNotes;
    this.addNoteToEvent = addNoteToEvent;
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
      placeholder_text: _("Search events"),
      hexpand: true,
    });
    this.searchEntry.connect("search-changed", () => this._scheduleSearch());
    content.append(this.searchEntry);

    this.stack = new Gtk.Stack({
      vexpand: true,
      transition_type: Gtk.StackTransitionType.CROSSFADE,
    });
    this.loadingPage = statusPage(
      _("Loading events"),
      _("Retrieving your events..."),
      "content-loading-symbolic",
    );
    this.emptyPage = statusPage(
      _("No events found"),
      _("Try another search or add your first event."),
      "x-office-calendar-symbolic",
    );
    this.errorPage = statusPage(
      _("Couldn't load events"),
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
    this.stack.add_named(scrolled, "events");
    content.append(this.stack);

    return newToolbarPage(_("Events"), content, (headerBar) => {
      const contactsButton = new Gtk.Button({ label: _("Contacts") });
      contactsButton.connect("clicked", this.switchToContacts);
      headerBar.pack_start(contactsButton);
      const notesButton = new Gtk.Button({ label: _("Notes") });
      notesButton.connect("clicked", this.switchToNotes);
      headerBar.pack_start(notesButton);

      const refreshButton = iconButton(
        "view-refresh-symbolic",
        _("Refresh events"),
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
    this.log(_("Loading events."));
    try {
      const events = await this.api.getEvents(this.searchEntry.text);
      if (requestNumber !== this.requestNumber) return;
      this._replaceEvents(events);
      this.stack.set_visible_child_name(events.length ? "events" : "empty");
      this.log(
        ngettext("%d event loaded.", "%d events loaded.", events.length)
          .replace("%d", String(events.length)),
      );
    } catch (error) {
      this.log(_("Loading events failed: %s").replace("%s", error.message), "ERROR");
      if (requestNumber === this.requestNumber) this.showError(error.message);
    }
  }

  _replaceEvents(events) {
    let child = this.listBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this.listBox.remove(child);
      child = next;
    }
    for (const event of events) {
      const row = new Adw.ActionRow({
        title: event.name,
        subtitle: `${formatLocalDateTime(event.start)} – ${
          formatLocalDateTime(event.end)
        }`,
        activatable: true,
      });
      row.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic" }));
      row.connect("activated", () => this._showEvent(event.key));
      this.listBox.append(row);
    }
  }

  async _showEvent(eventKey) {
    if (this.searchTimeout) GLib.source_remove(this.searchTimeout);
    this.searchTimeout = 0;
    const requestNumber = ++this.requestNumber;
    const sourcePage = this.navigation.visible_page;
    try {
      const [result, notes] = await Promise.all([
        this.api.getEvent(eventKey),
        this.api.getNotesForEvent(eventKey),
      ]);
      if (
        requestNumber !== this.requestNumber ||
        this.navigation.visible_page !== sourcePage
      ) return;
      this._replaceDetailPage({ ...result, notes });
      this.log(_("Event details loaded (key %d).").replace(
        "%d",
        String(eventKey),
      ));
    } catch (error) {
      if (
        requestNumber === this.requestNumber &&
        this.navigation.visible_page === sourcePage
      ) {
        this.log(_("Loading event details failed: %s").replace("%s", error.message), "ERROR");
        showMessage(this.window, _("Couldn't load event"), error.message);
      }
    }
  }

  _buildDetailPage(result) {
    const { event, contacts, notes = [] } = result;
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      margin_top: 12,
      margin_bottom: 18,
      margin_start: 12,
      margin_end: 12,
    });
    const details = new Adw.PreferencesGroup({ title: _("Event details") });
    addDetailRow(details, _("Starts"), formatLocalDateTime(event.start));
    addDetailRow(details, _("Ends"), formatLocalDateTime(event.end));
    addDetailRow(details, _("Comment"), event.comment);
    content.append(details);

    const contactsGroup = new Adw.PreferencesGroup({
      title: _("Assigned contacts"),
    });
    if (contacts.length) {
      for (const assignment of contacts) {
        contactsGroup.add(new Adw.ActionRow({
          title: assignment.contact.name,
          subtitle: assignment.role || assignment.contact.email || "",
        }));
      }
    } else {
      contactsGroup.add(new Adw.ActionRow({ title: _("No assigned contacts") }));
    }
    content.append(contactsGroup);

    const notesGroup = new Adw.PreferencesGroup({ title: _("Notes") });
    if (notes.length) {
      for (const note of notes) {
        notesGroup.add(this._noteRow(note));
      }
    } else {
      notesGroup.add(new Adw.ActionRow({
        title: _("No notes linked to this event"),
      }));
    }
    content.append(notesGroup);

    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vexpand: true,
      child: content,
    });
    return newToolbarPage(event.name, scrolled, (headerBar) => {
      const contactsButton = new Gtk.Button({ label: _("Contacts") });
      contactsButton.connect("clicked", this.switchToContacts);
      headerBar.pack_start(contactsButton);
      const notesButton = new Gtk.Button({ label: _("Notes") });
      notesButton.connect("clicked", this.switchToNotes);
      headerBar.pack_start(notesButton);

      const addNoteButton = new Gtk.Button({
        label: _("Add note"),
        icon_name: "list-add-symbolic",
      });
      addNoteButton.connect("clicked", () =>
        this.addNoteToEvent(
          event.key,
          () => this._showEvent(event.key),
          this.window,
        )
      );
      headerBar.pack_end(addNoteButton);
      const editButton = new Gtk.Button({ label: _("Edit") });
      editButton.connect("clicked", () => this._openForm(result));
      headerBar.pack_end(editButton);
      const deleteButton = iconButton(
        "user-trash-symbolic",
        _("Delete event"),
      );
      deleteButton.add_css_class("destructive-action");
      deleteButton.connect("clicked", () => this._confirmDelete(result));
      headerBar.pack_end(deleteButton);
      headerBar.pack_end(logMenuButton(this.window, this.showLog));
    });
  }

  _noteRow(note) {
    const text = note.text.replace(/\s+/g, " ").trim();
    return new Adw.ActionRow({
      title: note.heading,
      subtitle: text.length > 120 ? `${text.slice(0, 117)}…` : text,
    });
  }

  _replaceDetailPage(result) {
    this.navigation.replace([this.page, this._buildDetailPage(result)]);
  }

  async _openForm(result = null) {
    let contacts;
    try {
      contacts = await this.api.getContacts();
    } catch (error) {
      showMessage(this.window, _("Couldn't load contacts"), error.message);
      return;
    }

    const isEditing = result !== null;
    const originalEvent = result?.event ?? null;
    const originalLinks = result?.contacts ?? [];
    const originalLinksByContact = new Map(
      originalLinks.map((link) => [link.contact_key, link]),
    );
    const formWindow = new Adw.Window({
      transient_for: this.window,
      modal: true,
      title: isEditing ? _("Edit event") : _("New event"),
      default_width: 560,
      default_height: 720,
    });
    const toolbar = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
      title_widget: new Adw.WindowTitle({
        title: isEditing ? _("Edit event") : _("New event"),
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

    const eventGroup = new Adw.PreferencesGroup({ title: _("Event details") });
    const fields = {};
    const defaultStart = new Date();
    const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000);
    const defaultValues = {
      startDate: toLocalDateInput(defaultStart),
      startTime: toLocalTimeInput(defaultStart),
      endDate: toLocalDateInput(defaultEnd),
      endTime: toLocalTimeInput(defaultEnd),
    };
    for (const [field, title, required] of eventFields) {
      const row = new Adw.EntryRow({
        title: required ? `${title} (${_("required")})` : title,
      });
      if (field === "startDate" || field === "startTime") {
        row.text = originalEvent
          ? (field === "startDate"
            ? toLocalDateInput(originalEvent.start)
            : toLocalTimeInput(originalEvent.start))
          : defaultValues[field];
      } else if (field === "endDate" || field === "endTime") {
        row.text = originalEvent
          ? (field === "endDate"
            ? toLocalDateInput(originalEvent.end)
            : toLocalTimeInput(originalEvent.end))
          : defaultValues[field];
      } else {
        row.text = originalEvent?.[field] ?? "";
      }
      eventGroup.add(row);
      fields[field] = row;
    }
    form.append(eventGroup);
    form.append(new Gtk.Label({
      label: _("Event date and time use your local time zone."),
      xalign: 0,
      wrap: true,
    }));

    if (isEditing) {
      const notesGroup = new Adw.PreferencesGroup({ title: _("Notes") });
      let emptyNotesRow = null;
      const linkedNotes = result.notes ?? [];
      if (linkedNotes.length) {
        for (const note of linkedNotes) notesGroup.add(this._noteRow(note));
      } else {
        emptyNotesRow = new Adw.ActionRow({
          title: _("No notes linked to this event"),
        });
        notesGroup.add(emptyNotesRow);
      }
      const addNoteRow = new Adw.ActionRow({
        title: _("Add note"),
        activatable: true,
      });
      addNoteRow.add_suffix(new Gtk.Image({
        icon_name: "list-add-symbolic",
      }));
      addNoteRow.connect("activated", () => {
        this.addNoteToEvent(
          originalEvent.key,
          async (saved) => {
            if (emptyNotesRow) {
              notesGroup.remove(emptyNotesRow);
              emptyNotesRow = null;
            }
            notesGroup.remove(addNoteRow);
            notesGroup.add(this._noteRow(saved.note));
            notesGroup.add(addNoteRow);
            await this._showEvent(originalEvent.key);
          },
          formWindow,
        );
      });
      notesGroup.add(addNoteRow);
      form.append(notesGroup);
    }

    const contactGroup = new Adw.PreferencesGroup({
      title: _("Assigned contacts"),
    });
    const contactRows = [];
    const contactSearch = new Gtk.SearchEntry({
      placeholder_text: _("Search contacts"),
      hexpand: true,
    });
    form.append(contactSearch);
    const noMatchingContactsRow = new Adw.ActionRow({
      title: contacts.length
        ? _("No matching contacts")
        : _("No contacts available"),
      visible: false,
    });
    for (const item of contacts) {
      const contact = item.contact;
      const original = originalLinksByContact.get(contact.key) ?? null;
      const row = new Adw.ExpanderRow({
        title: contact.name,
        subtitle: [contact.city, original?.role].filter(Boolean).join(" · "),
        expanded: Boolean(original),
      });
      const role = new Adw.EntryRow({ title: _("Role") });
      role.text = original?.role ?? "";
      row.add_row(role);
      const selected = new Gtk.CheckButton({
        active: Boolean(original),
        valign: Gtk.Align.CENTER,
      });
      row.add_suffix(selected);
      contactGroup.add(row);
      contactRows.push({ contact, original, role, selected, row });
    }
    contactGroup.add(noMatchingContactsRow);
    const filterContacts = () => {
      let visibleContacts = 0;
      for (const item of contactRows) {
        const visible = shouldShowEventContactAssignment({
          contact: item.contact,
          original: item.original,
          selected: item.selected.active,
        }, contactSearch.text);
        item.row.visible = visible;
        if (visible) visibleContacts++;
      }
      noMatchingContactsRow.visible = visibleContacts === 0;
    };
    contactSearch.connect("search-changed", filterContacts);
    for (const item of contactRows) {
      item.selected.connect("toggled", filterContacts);
    }
    filterContacts();
    form.append(contactGroup);

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
        originalEvent,
        contactRows,
        fields,
        result,
        formWindow,
      }).catch((error) => {
        this.log(_("Event save failed: %s").replace("%s", error.message), "ERROR");
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
    originalEvent,
    contactRows,
    fields,
    result,
    formWindow,
  }) {
    const event = collectEventValues(
      Object.fromEntries(
        Object.entries(fields).map(([field, row]) => [field, row.text]),
      ),
      _,
    );
    const assignments = collectEventContactChanges(
      contactRows.map((item) => ({
        contact: item.contact,
        original: item.original,
        role: item.role.text,
        selected: item.selected.active,
      })),
      isEditing,
    );
    let saved;
    let persisted = false;
    if (isEditing) {
      const changes = {};
      for (const field of ["name", "start", "end", "comment"]) {
        if (event[field] !== originalEvent[field]) changes[field] = event[field];
      }
      if (Object.keys(changes).length || assignments.changes.length) {
        saved = await this.api.updateEvent(originalEvent.key, {
          expectedVersion: originalEvent.version,
          changes,
          contactChanges: assignments.changes,
        });
        persisted = true;
      } else {
        saved = result;
      }
    } else {
      saved = await this.api.createEvent({
        event,
        contacts: assignments.contacts,
      });
      persisted = true;
    }
    formWindow.close();
    await this.load();
    if (isEditing) await this._showEvent(saved.event.key);
    else await this._showEvent(saved.event.key);
    if (persisted) {
      showMessage(
        this.window,
        _("Event saved"),
        _("%s has been saved to the database.").replace("%s", saved.event.name),
      );
    }
  }

  _confirmDelete(result) {
    const dialog = new Adw.MessageDialog({
      transient_for: this.window,
      heading: _("Delete event?"),
      body: _("Delete %s? Its notes will be kept.").replace(
        "%s",
        result.event.name,
      ),
    });
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("delete", _("Delete"));
    dialog.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response("cancel");
    dialog.set_close_response("cancel");
    dialog.connect("response", async (_dialog, response) => {
      if (response !== "delete") return;
      try {
        await this.api.deleteEvent(result.event.key, result.event.version);
        this.navigation.pop();
        await this.load();
      } catch (error) {
        showMessage(this.window, _("Couldn't delete event"), error.message);
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
