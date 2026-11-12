export function collectContactValues(values, fields, translate) {
  const contact = {};
  for (const [field, title, required] of fields) {
    const value = values[field].trim();
    if (required && !value) {
      throw new Error(`${title} ${translate("is required.")}`);
    }
    contact[field] = required ? value : value || null;
  }
  return contact;
}

export function collectSocialChanges(rows, isEditing, originalSocials, translate) {
  const values = [];
  const changes = [];
  for (const item of rows) {
    const media = item.media.trim();
    const userid = item.userid.trim() || null;
    const comment = item.comment.trim() || null;
    if (!item.original && !media && !userid && !comment) continue;
    if (!media) {
      throw new Error(translate("Every social account needs a platform."));
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

export function toLocalDateInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toLocalTimeInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatLocalDateTime(value) {
  const date = toLocalDateInput(value);
  const time = toLocalTimeInput(value);
  return date && time ? `${date} ${time}` : value;
}

function parseLocalDateTime(dateValue, timeValue, translate) {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeParts = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeValue);
  if (!dateParts || !timeParts) {
    throw new Error(translate("Enter valid dates and times."));
  }
  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const hours = Number(timeParts[1]);
  const minutes = Number(timeParts[2]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hours, minutes, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) {
    throw new Error(translate("Enter valid dates and times."));
  }
  return date;
}

export function collectEventValues(values, translate) {
  const name = values.name.trim();
  if (!name) throw new Error(translate("Name is required."));
  const startDateValue = values.startDate.trim();
  const startTimeValue = values.startTime.trim();
  const endDateValue = values.endDate.trim();
  const endTimeValue = values.endTime.trim();
  if (!startDateValue || !startTimeValue || !endDateValue || !endTimeValue) {
    throw new Error(translate("Event dates and times are required."));
  }
  const start = parseLocalDateTime(startDateValue, startTimeValue, translate);
  const end = parseLocalDateTime(endDateValue, endTimeValue, translate);
  if (end <= start) {
    throw new Error(translate("Event end must be later than its start."));
  }
  return {
    name,
    start: start.toISOString(),
    end: end.toISOString(),
    comment: values.comment.trim() || null,
  };
}

export function collectEventContactChanges(rows, isEditing = false) {
  const contacts = [];
  const changes = [];
  for (const item of rows) {
    const role = item.role.trim() || null;
    if (item.selected) {
      if (!item.original) {
        const contact = { contactKey: item.contact.key, role };
        if (isEditing) changes.push({ type: "add", ...contact });
        else contacts.push(contact);
      } else if (role !== item.original.role) {
        changes.push({
          type: "update",
          key: item.original.key,
          expectedVersion: item.original.version,
          changes: { role },
        });
      }
    } else if (item.original) {
      changes.push({
        type: "delete",
        key: item.original.key,
        expectedVersion: item.original.version,
      });
    }
  }
  return { contacts, changes };
}

export function shouldShowEventContactAssignment(item, searchText) {
  if (item.original || item.selected) return true;
  const query = searchText.trim().toLocaleLowerCase();
  if (!query) return true;
  return [item.contact.name, item.contact.city, item.contact.email]
    .filter(Boolean)
    .some((value) => value.toLocaleLowerCase().includes(query));
}

export function collectNoteValues(values, translate) {
  const heading = values.heading.trim();
  const text = values.text.trim();
  if (!heading) throw new Error(translate("Note heading is required."));
  if (!text) throw new Error(translate("Note text is required."));
  return { heading, text };
}

export function collectNoteAssignments(contactRows, eventRows) {
  return {
    contactKeys: contactRows
      .filter((row) => row.selected)
      .map((row) => row.contact.key),
    eventKeys: eventRows
      .filter((row) => row.selected)
      .map((row) => row.event.key),
  };
}
