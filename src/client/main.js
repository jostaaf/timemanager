import Adw from "gi://Adw?version=1";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import { ContactsApi } from "./contacts-api.js";
import {
  gettext as _,
  initializeLocalization,
  ngettext,
} from "./i18n.js";

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

const contactFields = [
  ["name", _("Name"), true],
  ["street", _("Street"), true],
  ["zip", _("Postcode"), true],
  ["city", _("City"), true],
  ["phone", _("Phone"), false],
  ["email", _("Email"), false],
  ["tag", _("Tag"), false],
  ["comment", _("Comment"), false],
];

class ContactsWindow {
  constructor(application) {
    this.api = new ContactsApi(projectRoot);
    this.requestNumber = 0;
    this.searchTimeout = 0;
    this.logEntries = [];
    this.api.onLog = (message, level) => this._log(message, level);
    this._log(_("Local contacts client started."));

    this.window = new Adw.ApplicationWindow({
      application,
      title: _("Time Manager"),
      default_width: 760,
      default_height: 640,
    });
    this.window.connect("close-request", () => {
      this._log(_("Client window closed."));
      this.api.stop();
      return false;
    });

    this.navigation = new Adw.NavigationView();
    this.listPage = this._buildListPage();
    this.navigation.add(this.listPage);
    this.window.set_content(this.navigation);
    this.api.onUnexpectedExit = (message) => {
      this._log(_("Local API stopped unexpectedly: %s").replace("%s", message), "ERROR");
      this._showError(message);
    };
    this.window.present();
    this._startApi();
  }

  _newToolbarPage(title, content, configureHeader = () => {}) {
    const toolbar = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
      title_widget: new Adw.WindowTitle({ title }),
    });
    configureHeader(headerBar);
    toolbar.add_top_bar(headerBar);
    toolbar.set_content(content);
    return new Adw.NavigationPage({ title, child: toolbar });
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
      placeholder_text: _("Search contacts"),
      hexpand: true,
    });
    this.searchEntry.connect("search-changed", () => this._scheduleSearch());
    content.append(this.searchEntry);

    this.stack = new Gtk.Stack({
      vexpand: true,
      transition_type: Gtk.StackTransitionType.CROSSFADE,
    });
    this.loadingPage = this._statusPage(
      _("Starting local service"),
      _("Connecting to your contacts database..."),
      "content-loading-symbolic",
    );
    this.emptyPage = this._statusPage(
      _("No contacts found"),
      _("Try another search or add your first contact."),
      "contact-new-symbolic",
    );
    this.errorPage = this._statusPage(
      _("Couldn't load contacts"),
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
    this.stack.add_named(scrolled, "contacts");
    content.append(this.stack);

    return this._newToolbarPage(_("Contacts"), content, (headerBar) => {
      const refreshButton = this._iconButton(
        "view-refresh-symbolic",
        _("Refresh contacts"),
      );
      refreshButton.connect("clicked", () => {
        if (this.api.baseUrl) this.loadContacts();
        else this._startApi();
      });
      headerBar.pack_end(refreshButton);

      const addButton = new Gtk.Button({
        label: _("New"),
        icon_name: "list-add-symbolic",
      });
      addButton.add_css_class("suggested-action");
      addButton.connect("clicked", () => this._openContactForm());
      headerBar.pack_end(addButton);
      headerBar.pack_end(this._logMenuButton(this.window));
    });
  }

  _iconButton(iconName, accessibleName) {
    const button = new Gtk.Button({
      icon_name: iconName,
      tooltip_text: accessibleName,
    });
    button.update_property([Gtk.AccessibleProperty.LABEL], [accessibleName]);
    return button;
  }

  _logMenuButton(parentWindow) {
    const showLogButton = new Gtk.Button({
      label: _("Show Log"),
      halign: Gtk.Align.FILL,
    });
    showLogButton.connect("clicked", () => {
      menuButton.popover.popdown();
      this._showLog(parentWindow);
    });
    const popover = new Gtk.Popover({ child: showLogButton });
    const menuButton = new Gtk.MenuButton({
      icon_name: "open-menu-symbolic",
      tooltip_text: _("Application menu"),
      popover,
    });
    return menuButton;
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

  _statusPage(title, description, iconName) {
    return new Adw.StatusPage({
      title,
      description,
      icon_name: iconName,
    });
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
      await this.loadContacts();
    } catch (error) {
      this._log(_("Local API startup failed: %s").replace("%s", error.message), "ERROR");
      this.api.stop();
      this._showError(error.message);
    }
  }

  _scheduleSearch() {
    if (this.searchTimeout) GLib.source_remove(this.searchTimeout);
    this.searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
      this.searchTimeout = 0;
      this.loadContacts();
      return GLib.SOURCE_REMOVE;
    });
  }

  async loadContacts() {
    const requestNumber = ++this.requestNumber;
    this._log(_("Loading contacts."));
    this.stack.set_visible_child_name("loading");
    try {
      const contacts = await this.api.getContacts(this.searchEntry.text);
      if (requestNumber !== this.requestNumber) return;
      this._replaceContacts(contacts);
      this.stack.set_visible_child_name(contacts.length ? "contacts" : "empty");
      this._log(
        ngettext("%d contact loaded.", "%d contacts loaded.", contacts.length)
          .replace("%d", String(contacts.length)),
      );
    } catch (error) {
      this._log(_("Loading contacts failed: %s").replace("%s", error.message), "ERROR");
      if (requestNumber === this.requestNumber) this._showError(error.message);
    }
  }

  _replaceContacts(contacts) {
    let child = this.listBox.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this.listBox.remove(child);
      child = next;
    }

    for (const item of contacts) {
      const contact = item.contact;
      const details = [
        `${contact.street}, ${contact.zip} ${contact.city}`,
        contact.phone,
        contact.email,
        item.socials.length
          ? ngettext(
            "%d social account",
            "%d social accounts",
            item.socials.length,
          ).replace("%d", String(item.socials.length))
          : null,
      ].filter(Boolean);
      const row = new Adw.ActionRow({
        title: contact.name,
        subtitle: details.join(" | "),
        activatable: true,
      });
      row.add_suffix(new Gtk.Image({ icon_name: "go-next-symbolic" }));
      row.connect("activated", () => this._showContact(contact.key));
      this.listBox.append(row);
    }
  }

  async _showContact(contactKey) {
    const requestNumber = ++this.requestNumber;
    const loadingPage = this._newToolbarPage(
      _("Contact"),
      this._statusPage(
        _("Loading contact"),
        _("Retrieving contact details..."),
        "content-loading-symbolic",
      ),
    );
    this.navigation.push(loadingPage);
    try {
      const result = await this.api.getContact(contactKey);
      if (
        requestNumber !== this.requestNumber ||
        this.navigation.visible_page !== loadingPage
      ) return;
      this._log(_("Contact details loaded (key %d).").replace(
        "%d",
        String(contactKey),
      ));
      this._replaceDetailPage(result);
    } catch (error) {
      if (requestNumber === this.requestNumber) {
        this._log(_("Loading contact details failed: %s").replace("%s", error.message), "ERROR");
        this.navigation.pop();
        this._showError(error.message);
      }
    }
  }

  _buildDetailPage(result) {
    const { contact, socials } = result;
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      margin_top: 12,
      margin_bottom: 18,
      margin_start: 12,
      margin_end: 12,
    });
    const details = new Adw.PreferencesGroup({ title: _("Contact details") });
    for (const [field, title] of contactFields) {
      this._addDetailRow(details, title, contact[field]);
    }
    content.append(details);

    if (socials.length) {
      const socialGroup = new Adw.PreferencesGroup({
        title: _("Social accounts"),
      });
      for (const social of socials) {
        const values = [social.userid, social.comment].filter(Boolean);
        socialGroup.add(new Adw.ActionRow({
          title: social.media,
          subtitle: values.join(" | "),
        }));
      }
      content.append(socialGroup);
    }

    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vexpand: true,
      child: content,
    });
    return this._newToolbarPage(contact.name, scrolled, (headerBar) => {
      const editButton = new Gtk.Button({ label: _("Edit") });
      editButton.connect("clicked", () => {
        this._log(_("Opening editor for contact key %d.").replace(
          "%d",
          String(contact.key),
        ));
        this._openContactForm(result);
      });
      headerBar.pack_end(editButton);

      const deleteButton = this._iconButton(
        "user-trash-symbolic",
        _("Delete contact"),
      );
      deleteButton.add_css_class("destructive-action");
      deleteButton.connect("clicked", () => this._confirmDelete(result));
      headerBar.pack_end(deleteButton);
      headerBar.pack_end(this._logMenuButton(this.window));
    });
  }

  _replaceDetailPage(result) {
    this.navigation.replace([this.listPage, this._buildDetailPage(result)]);
  }

  _addDetailRow(group, title, value) {
    group.add(new Adw.ActionRow({
      title,
      subtitle: value || "—",
    }));
  }

  _openContactForm(result = null) {
    const isEditing = result !== null;
    const originalContact = result?.contact ?? null;
    const formWindow = new Adw.Window({
      transient_for: this.window,
      modal: true,
      title: isEditing ? _("Edit contact") : _("New contact"),
      default_width: 560,
      default_height: 720,
    });
    const toolbar = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
      title_widget: new Adw.WindowTitle({
        title: isEditing ? _("Edit contact") : _("New contact"),
      }),
    });
    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    cancelButton.connect("clicked", () => formWindow.close());
    headerBar.pack_start(cancelButton);
    const saveButton = new Gtk.Button({ label: _("Save") });
    saveButton.add_css_class("suggested-action");
    headerBar.pack_end(saveButton);
    headerBar.pack_end(this._logMenuButton(formWindow));
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

    const contactGroup = new Adw.PreferencesGroup({
      title: _("Contact details"),
    });
    const fields = {};
    for (const [field, title, required] of contactFields) {
      const row = new Adw.EntryRow({
        title: required ? `${title} (${_("required")})` : title,
      });
      row.text = originalContact?.[field] ?? "";
      contactGroup.add(row);
      fields[field] = row;
    }
    form.append(contactGroup);

    const socialGroup = new Adw.PreferencesGroup({
      title: _("Social accounts"),
    });
    const socialRows = [];
    const originalSocials = result?.socials ?? [];
    const addSocialRow = (social = null) => {
      const row = new Adw.ExpanderRow({
        title: social?.media || _("New social account"),
        subtitle: social?.userid ?? "",
        expanded: true,
      });
      const media = new Adw.EntryRow({
        title: `${_("Platform")} (${_("required")})`,
      });
      const userid = new Adw.EntryRow({ title: _("User ID") });
      const comment = new Adw.EntryRow({ title: _("Comment") });
      media.text = social?.media ?? "";
      userid.text = social?.userid ?? "";
      comment.text = social?.comment ?? "";
      row.add_row(media);
      row.add_row(userid);
      row.add_row(comment);
      media.connect("changed", () => {
        row.title = media.text.trim() || _("New social account");
      });
      userid.connect("changed", () => {
        row.subtitle = userid.text.trim();
      });
      const removeButton = this._iconButton(
        "list-remove-symbolic",
        _("Remove social account"),
      );
      removeButton.connect("clicked", () => {
        socialGroup.remove(row);
        const index = socialRows.findIndex((item) => item.row === row);
        if (index >= 0) socialRows.splice(index, 1);
      });
      row.add_suffix(removeButton);
      socialGroup.add(row);
      socialRows.push({ row, media, userid, comment, original: social });
    };
    for (const social of result?.socials ?? []) addSocialRow(social);
    const addSocialButton = new Gtk.Button({
      label: _("Add social account"),
      icon_name: "list-add-symbolic",
      halign: Gtk.Align.START,
    });
    addSocialButton.add_css_class("flat");
    addSocialButton.connect("clicked", () => addSocialRow());
    form.append(socialGroup);
    form.append(addSocialButton);

    const scrolled = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vexpand: true,
      child: form,
    });
    toolbar.set_content(scrolled);
    formWindow.set_content(toolbar);
    saveButton.connect("clicked", () => {
      this._log(
        _("Save clicked for %s contact.").replace(
          "%s",
          isEditing ? _("existing") : _("new"),
        ),
      );
      saveButton.sensitive = false;
      saveButton.label = _("Saving...");
      errorLabel.visible = false;
      this._saveContactForm({
        isEditing,
        originalContact,
        originalSocials,
        socialRows,
        fields,
        result,
        formWindow,
      }).catch((error) => {
        this._log(_("Contact save failed: %s").replace("%s", error.message), "ERROR");
        errorLabel.label = error.message;
        errorLabel.visible = true;
        scrolled.vadjustment.value = 0;
        saveButton.label = _("Save");
        saveButton.sensitive = true;
      });
    });
    formWindow.present();
  }

  async _saveContactForm({
    isEditing,
    originalContact,
    originalSocials,
    socialRows,
    fields,
    result,
    formWindow,
  }) {
    this._log(_("Validating contact form."));
    const contact = this._collectContact(fields);
    const socials = this._collectSocialChanges(
      socialRows,
      isEditing,
      originalSocials,
    );
    let saved;
    let persisted = false;
    if (isEditing) {
      const changes = {};
      for (const [field] of contactFields) {
        if (contact[field] !== originalContact[field]) {
          changes[field] = contact[field];
        }
      }
      const socialChanges = socials.changes;
      this._log(
        _("Contact changes: %s; social changes: %d.")
          .replace("%s", Object.keys(changes).join(", ") || _("none"))
          .replace("%d", String(socialChanges.length)),
      );
      if (Object.keys(changes).length || socialChanges.length) {
        this._log(_("Submitting contact update for key %d.").replace(
          "%d",
          String(originalContact.key),
        ));
        saved = await this.api.updateContact(originalContact.key, {
          expectedVersion: originalContact.version,
          changes,
          socialChanges,
        });
        persisted = true;
      } else {
        saved = result;
      }
    } else {
      this._log(_("Submitting new contact."));
      saved = await this.api.createContact({
        contact,
        socials: socials.values,
      });
      persisted = true;
    }
    this._log(
      _("Save request completed for contact key %d at version %d.")
        .replace("%d", String(saved.contact.key))
        .replace("%d", String(saved.contact.version)),
    );
    formWindow.close();
    this.searchEntry.text = "";
    await this.loadContacts();
    if (isEditing) this._replaceDetailPage(saved);
    else await this._showContact(saved.contact.key);
    if (persisted) {
      this._showMessage(
        _("Contact saved"),
        _("%s has been saved to the database.").replace(
          "%s",
          saved.contact.name,
        ),
      );
    } else {
      this._log(_("No changes detected; nothing was sent to the database."));
    }
  }

  _collectContact(fields) {
    const contact = {};
    for (const [field, title, required] of contactFields) {
      const value = fields[field].text.trim();
      if (required && !value) throw new Error(`${title} ${_("is required.")}`);
      contact[field] = required ? value : value || null;
    }
    return contact;
  }

  _collectSocialChanges(rows, isEditing, originalSocials) {
    const values = [];
    const changes = [];
    for (const item of rows) {
      const media = item.media.text.trim();
      const userid = item.userid.text.trim() || null;
      const comment = item.comment.text.trim() || null;
      if (!item.original && !media && !userid && !comment) continue;
      if (!media) {
        throw new Error(_("Every social account needs a platform."));
      }
      const current = { media, userid, comment };

      if (!item.original) {
        if (isEditing) changes.push({ type: "add", record: current });
        else values.push(current);
      } else {
        const socialChanges = {};
        for (const field of ["media", "userid", "comment"]) {
          if (current[field] !== item.original[field]) {
            socialChanges[field] = current[field];
          }
        }
        if (Object.keys(socialChanges).length) {
          changes.push({
            type: "update",
            key: item.original.key,
            expectedVersion: item.original.version,
            changes: socialChanges,
          });
        }
      }
    }
    if (isEditing) {
      const currentRows = new Set(
        rows.map((item) => item.original).filter(Boolean),
      );
      for (const social of originalSocials) {
        if (!currentRows.has(social)) {
          changes.push({
            type: "delete",
            key: social.key,
            expectedVersion: social.version,
          });
        }
      }
    }
    return { values, changes };
  }

  _confirmDelete(result) {
    const dialog = new Adw.MessageDialog({
      transient_for: this.window,
      heading: _("Delete contact?"),
      body: _("Delete %s? This will also remove their social accounts.").replace(
        "%s",
        result.contact.name,
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
        await this.api.deleteContact(result.contact.key, result.contact.version);
        this.navigation.pop();
        await this.loadContacts();
      } catch (error) {
        this._showMessage(_("Couldn't delete contact"), error.message);
      }
    });
    dialog.present();
  }

  _showMessage(heading, body) {
    const dialog = new Adw.MessageDialog({
      transient_for: this.window,
      heading,
      body,
    });
    dialog.add_response("close", _("Close"));
    dialog.set_close_response("close");
    dialog.present();
  }

  _showError(message) {
    this.errorPage.description = message;
    this.stack.set_visible_child_name("error");
  }
}

const application = new Adw.Application({
  application_id: "io.github.jostaaf.TimeManager",
  flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
});
let contactsWindow = null;

application.connect("activate", (app) => {
  if (!contactsWindow) contactsWindow = new ContactsWindow(app);
  else contactsWindow.window.present();
});
application.connect("shutdown", () => contactsWindow?.api.stop());
application.run([]);
