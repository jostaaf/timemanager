import Adw from "gi://Adw?version=1";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import { gettext as _, ngettext } from "./i18n.js";
import {
  collectContactValues,
  collectSocialChanges,
} from "./form-model.js";
import {
  addDetailRow,
  iconButton,
  logMenuButton,
  newToolbarPage,
  showMessage,
  statusPage,
} from "./shared-ui.js";

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

export class ContactsView {
  constructor({
    api,
    window,
    navigation,
    log,
    showLog,
    refresh,
    switchToEvents,
    switchToNotes,
  }) {
    this.api = api;
    this.window = window;
    this.navigation = navigation;
    this.log = log;
    this.showLog = showLog;
    this.refresh = refresh;
    this.switchToEvents = switchToEvents;
    this.switchToNotes = switchToNotes;
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
      placeholder_text: _("Search contacts"),
      hexpand: true,
    });
    this.searchEntry.connect("search-changed", () => this._scheduleSearch());
    content.append(this.searchEntry);

    this.stack = new Gtk.Stack({
      vexpand: true,
      transition_type: Gtk.StackTransitionType.CROSSFADE,
    });
    this.loadingPage = statusPage(
      _("Starting local service"),
      _("Connecting to your contacts database..."),
      "content-loading-symbolic",
    );
    this.emptyPage = statusPage(
      _("No contacts found"),
      _("Try another search or add your first contact."),
      "contact-new-symbolic",
    );
    this.errorPage = statusPage(
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

    return newToolbarPage(_("Contacts"), content, (headerBar) => {
      const eventsButton = new Gtk.Button({ label: _("Events") });
      eventsButton.connect("clicked", this.switchToEvents);
      headerBar.pack_start(eventsButton);
      const notesButton = new Gtk.Button({ label: _("Notes") });
      notesButton.connect("clicked", this.switchToNotes);
      headerBar.pack_start(notesButton);

      const refreshButton = iconButton(
        "view-refresh-symbolic",
        _("Refresh contacts"),
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
    this.searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
      this.searchTimeout = 0;
      this.load();
      return GLib.SOURCE_REMOVE;
    });
  }

  async load() {
    const requestNumber = ++this.requestNumber;
    this.log(_("Loading contacts."));
    this.stack.set_visible_child_name("loading");
    try {
      const contacts = await this.api.getContacts(this.searchEntry.text);
      if (requestNumber !== this.requestNumber) return;
      this._replaceContacts(contacts);
      this.stack.set_visible_child_name(contacts.length ? "contacts" : "empty");
      this.log(
        ngettext("%d contact loaded.", "%d contacts loaded.", contacts.length)
          .replace("%d", String(contacts.length)),
      );
    } catch (error) {
      this.log(_("Loading contacts failed: %s").replace("%s", error.message), "ERROR");
      if (requestNumber === this.requestNumber) this.showError(error.message);
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
    if (this.searchTimeout) GLib.source_remove(this.searchTimeout);
    this.searchTimeout = 0;
    const requestNumber = ++this.requestNumber;
    const sourcePage = this.navigation.visible_page;
    try {
      const result = await this.api.getContact(contactKey);
      if (
        requestNumber !== this.requestNumber ||
        this.navigation.visible_page !== sourcePage
      ) return;
      this.log(_("Contact details loaded (key %d).").replace(
        "%d",
        String(contactKey),
      ));
      this._replaceDetailPage(result);
    } catch (error) {
      if (
        requestNumber === this.requestNumber &&
        this.navigation.visible_page === sourcePage
      ) {
        this.log(_("Loading contact details failed: %s").replace("%s", error.message), "ERROR");
        this.showError(error.message);
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
      addDetailRow(details, title, contact[field]);
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
    return newToolbarPage(contact.name, scrolled, (headerBar) => {
      const eventsButton = new Gtk.Button({ label: _("Events") });
      eventsButton.connect("clicked", this.switchToEvents);
      headerBar.pack_start(eventsButton);
      const notesButton = new Gtk.Button({ label: _("Notes") });
      notesButton.connect("clicked", this.switchToNotes);
      headerBar.pack_start(notesButton);

      const editButton = new Gtk.Button({ label: _("Edit") });
      editButton.connect("clicked", () => {
        this.log(_("Opening editor for contact key %d.").replace(
          "%d",
          String(contact.key),
        ));
        this._openForm(result);
      });
      headerBar.pack_end(editButton);
      const deleteButton = iconButton(
        "user-trash-symbolic",
        _("Delete contact"),
      );
      deleteButton.add_css_class("destructive-action");
      deleteButton.connect("clicked", () => this._confirmDelete(result));
      headerBar.pack_end(deleteButton);
      headerBar.pack_end(logMenuButton(this.window, this.showLog));
    });
  }

  _replaceDetailPage(result) {
    this.navigation.replace([this.page, this._buildDetailPage(result)]);
  }

  async _openForm(result = null) {
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
      const removeButton = iconButton(
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
    for (const social of originalSocials) addSocialRow(social);
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
      this.log(
        _("Save clicked for %s contact.").replace(
          "%s",
          isEditing ? _("existing") : _("new"),
        ),
      );
      saveButton.sensitive = false;
      saveButton.label = _("Saving...");
      errorLabel.visible = false;
      this._saveForm({
        isEditing,
        originalContact,
        originalSocials,
        socialRows,
        fields,
        result,
        formWindow,
      }).catch((error) => {
        this.log(_("Contact save failed: %s").replace("%s", error.message), "ERROR");
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
    originalContact,
    originalSocials,
    socialRows,
    fields,
    result,
    formWindow,
  }) {
    this.log(_("Validating contact form."));
    const contact = collectContactValues(
      Object.fromEntries(
        Object.entries(fields).map(([field, row]) => [field, row.text]),
      ),
      contactFields,
      _,
    );
    const socials = collectSocialChanges(
      socialRows.map((item) => ({
        media: item.media.text,
        userid: item.userid.text,
        comment: item.comment.text,
        original: item.original,
      })),
      isEditing,
      originalSocials,
      _,
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
      this.log(
        _("Contact changes: %s; social changes: %d.")
          .replace("%s", Object.keys(changes).join(", ") || _("none"))
          .replace("%d", String(socials.changes.length)),
      );
      if (Object.keys(changes).length || socials.changes.length) {
        this.log(_("Submitting contact update for key %d.").replace(
          "%d",
          String(originalContact.key),
        ));
        saved = await this.api.updateContact(originalContact.key, {
          expectedVersion: originalContact.version,
          changes,
          socialChanges: socials.changes,
        });
        persisted = true;
      } else {
        saved = result;
      }
    } else {
      this.log(_("Submitting new contact."));
      saved = await this.api.createContact({
        contact,
        socials: socials.values,
      });
      persisted = true;
    }
    this.log(
      _("Save request completed for contact key %d at version %d.")
        .replace("%d", String(saved.contact.key))
        .replace("%d", String(saved.contact.version)),
    );
    formWindow.close();
    this.searchEntry.text = "";
    await this.load();
    if (isEditing) this._replaceDetailPage(saved);
    else await this._showContact(saved.contact.key);
    if (persisted) {
      showMessage(
        this.window,
        _("Contact saved"),
        _("%s has been saved to the database.").replace("%s", saved.contact.name),
      );
    } else {
      this.log(_("No changes detected; nothing was sent to the database."));
    }
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
        await this.load();
      } catch (error) {
        showMessage(this.window, _("Couldn't delete contact"), error.message);
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
