CREATE TEMP TABLE note_legacy_links AS
SELECT "key", "event_key", "contact_key"
FROM note;

CREATE TABLE note_new (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heading" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("heading", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  "text" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("text", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  PRIMARY KEY ("key")
);

INSERT INTO note_new ("key", "version", "created_at", "heading", "text")
SELECT "key", "version", "created_at", "heading", "text"
FROM note;

DROP TABLE note;
ALTER TABLE note_new RENAME TO note;

CREATE TABLE note_contacts (
  "note_key" INTEGER NOT NULL,
  "contact_key" INTEGER NOT NULL,
  PRIMARY KEY ("note_key", "contact_key"),
  FOREIGN KEY ("note_key") REFERENCES note ("key") ON DELETE CASCADE,
  FOREIGN KEY ("contact_key") REFERENCES contact ("key") ON DELETE CASCADE
);

CREATE TABLE note_events (
  "note_key" INTEGER NOT NULL,
  "event_key" INTEGER NOT NULL,
  PRIMARY KEY ("note_key", "event_key"),
  FOREIGN KEY ("note_key") REFERENCES note ("key") ON DELETE CASCADE,
  FOREIGN KEY ("event_key") REFERENCES event ("key") ON DELETE CASCADE
);

INSERT INTO note_contacts ("note_key", "contact_key")
SELECT "key", "contact_key"
FROM note_legacy_links
WHERE "contact_key" IS NOT NULL;

INSERT INTO note_events ("note_key", "event_key")
SELECT "key", "event_key"
FROM note_legacy_links
WHERE "event_key" IS NOT NULL;

DROP TABLE note_legacy_links;

CREATE INDEX "ix_note_contacts_contact_key" ON note_contacts ("contact_key");
CREATE INDEX "ix_note_events_event_key" ON note_events ("event_key");
