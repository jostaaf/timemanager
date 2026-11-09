const Gettext = imports.gettext;
const domain = "timemanager";

export function initializeLocalization(localeDirectory) {
  Gettext.setlocale(Gettext.LocaleCategory.ALL, "");
  Gettext.bindtextdomain(domain, localeDirectory);
  Gettext.textdomain(domain);
}

export function gettext(message) {
  return Gettext.gettext(message);
}

export function ngettext(singular, plural, count) {
  return Gettext.ngettext(singular, plural, count);
}
