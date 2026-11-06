CREATE TABLE IF NOT EXISTS "note" (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heading" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("heading", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  "text" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("text", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  "event_key" INTEGER,
  "contact_key" INTEGER,
  PRIMARY KEY ("key"),
  FOREIGN KEY ("event_key") REFERENCES "event" ("key") ON DELETE SET NULL,
  FOREIGN KEY ("contact_key") REFERENCES "contact" ("key") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "ix_note_event_key" ON "note" ("event_key" ASC);
CREATE INDEX IF NOT EXISTS "ix_note_contact_key" ON "note" ("contact_key" ASC);

DROP TRIGGER IF EXISTS "tr_note_requires_assignment";
DROP TRIGGER IF EXISTS "tr_note_parent_change_increments_version";
