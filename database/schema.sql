CREATE TABLE "contact" (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL COLLATE RTRIM,
  "street" TEXT NOT NULL COLLATE RTRIM,
  "zip" TEXT NOT NULL COLLATE RTRIM,
  "city" TEXT NOT NULL COLLATE RTRIM,
  "phone" TEXT COLLATE RTRIM,
  "email" TEXT COLLATE RTRIM,
  "tag" TEXT COLLATE RTRIM,
  "comment" TEXT COLLATE RTRIM,
  PRIMARY KEY ("key")
);

CREATE TABLE "contact_socials" (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "contact_key" INTEGER NOT NULL,
  "media" TEXT NOT NULL COLLATE RTRIM,
  "userid" TEXT COLLATE RTRIM,
  "comment" TEXT COLLATE RTRIM,
  PRIMARY KEY ("key"),
  FOREIGN KEY ("contact_key") REFERENCES "contact" ("key") ON DELETE CASCADE
);

CREATE TABLE "event" (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL COLLATE RTRIM,
  "start" TEXT NOT NULL COLLATE RTRIM,
  "end" TEXT NOT NULL COLLATE RTRIM,
  "comment" TEXT COLLATE RTRIM,
  PRIMARY KEY ("key")
);

CREATE TABLE "event_contacts" (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "event_key" INTEGER NOT NULL,
  "contact_key" INTEGER NOT NULL,
  "role" TEXT COLLATE RTRIM,
  PRIMARY KEY ("key"),
  FOREIGN KEY ("event_key") REFERENCES "event" ("key") ON DELETE CASCADE,
  FOREIGN KEY ("contact_key") REFERENCES "contact" ("key") ON DELETE CASCADE
);

CREATE TABLE "note" (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "heading" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("heading", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  "text" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("text", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  PRIMARY KEY ("key")
);

CREATE TABLE "note_contacts" (
  "note_key" INTEGER NOT NULL,
  "contact_key" INTEGER NOT NULL,
  PRIMARY KEY ("note_key", "contact_key"),
  FOREIGN KEY ("note_key") REFERENCES "note" ("key") ON DELETE CASCADE,
  FOREIGN KEY ("contact_key") REFERENCES "contact" ("key") ON DELETE CASCADE
);

CREATE TABLE "note_events" (
  "note_key" INTEGER NOT NULL,
  "event_key" INTEGER NOT NULL,
  PRIMARY KEY ("note_key", "event_key"),
  FOREIGN KEY ("note_key") REFERENCES "note" ("key") ON DELETE CASCADE,
  FOREIGN KEY ("event_key") REFERENCES "event" ("key") ON DELETE CASCADE
);

CREATE INDEX "ix_contact_city" ON "contact" ("city" ASC);
CREATE INDEX "ix_contact_name" ON "contact" ("name" ASC);
CREATE INDEX "ix_event_contacts_contact_key" ON "event_contacts" ("contact_key" ASC);
CREATE INDEX "ix_event_contacts_event_key" ON "event_contacts" ("event_key" ASC);
CREATE INDEX "ix_note_contacts_contact_key" ON "note_contacts" ("contact_key");
CREATE INDEX "ix_note_events_event_key" ON "note_events" ("event_key");
CREATE INDEX "ix_social_contact_key" ON "contact_socials" ("contact_key" ASC);
CREATE INDEX "ix_social_media" ON "contact_socials" ("media" ASC);
