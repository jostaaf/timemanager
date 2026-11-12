import Adw from "gi://Adw?version=1";
import Gtk from "gi://Gtk?version=4.0";
import { gettext as _ } from "./i18n.js";

export function newToolbarPage(title, content, configureHeader = () => {}) {
  const toolbar = new Adw.ToolbarView();
  const headerBar = new Adw.HeaderBar({
    title_widget: new Adw.WindowTitle({ title }),
  });
  configureHeader(headerBar);
  toolbar.add_top_bar(headerBar);
  toolbar.set_content(content);
  return new Adw.NavigationPage({ title, child: toolbar });
}

export function statusPage(title, description, iconName) {
  return new Adw.StatusPage({
    title,
    description,
    icon_name: iconName,
  });
}

export function iconButton(iconName, accessibleName) {
  const button = new Gtk.Button({
    icon_name: iconName,
    tooltip_text: accessibleName,
  });
  button.update_property([Gtk.AccessibleProperty.LABEL], [accessibleName]);
  return button;
}

export function logMenuButton(parentWindow, showLog) {
  const showLogButton = new Gtk.Button({
    label: _("Show Log"),
    halign: Gtk.Align.FILL,
  });
  const popover = new Gtk.Popover({ child: showLogButton });
  const menuButton = new Gtk.MenuButton({
    icon_name: "open-menu-symbolic",
    tooltip_text: _("Application menu"),
    popover,
  });
  showLogButton.connect("clicked", () => {
    popover.popdown();
    showLog(parentWindow);
  });
  return menuButton;
}

export function addDetailRow(group, title, value) {
  group.add(new Adw.ActionRow({
    title,
    subtitle: value || "—",
  }));
}

export function showMessage(parentWindow, heading, body) {
  const dialog = new Adw.MessageDialog({
    transient_for: parentWindow,
    heading,
    body,
  });
  dialog.add_response("close", _("Close"));
  dialog.set_close_response("close");
  dialog.present();
}
