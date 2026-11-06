CREATE TABLE contact_socials_new (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "contact_key" INTEGER NOT NULL,
  "media" TEXT NOT NULL COLLATE RTRIM,
  "userid" TEXT COLLATE RTRIM,
  "comment" TEXT COLLATE RTRIM,
  PRIMARY KEY ("key"),
  FOREIGN KEY ("contact_key") REFERENCES contact ("key") ON DELETE CASCADE
);

INSERT INTO contact_socials_new
  ("key", "version", "contact_key", "media", "userid", "comment")
SELECT
  "key", "version", "contact_key", "media", "userid", "comment"
FROM contact_socials;

DROP TABLE contact_socials;
ALTER TABLE contact_socials_new RENAME TO contact_socials;
CREATE INDEX "ix_social_contact_key" ON contact_socials ("contact_key" ASC);
CREATE INDEX "ix_social_media" ON contact_socials ("media" ASC);

CREATE TABLE event_contacts_new (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "event_key" INTEGER NOT NULL,
  "contact_key" INTEGER NOT NULL,
  "role" TEXT COLLATE RTRIM,
  PRIMARY KEY ("key"),
  FOREIGN KEY ("event_key") REFERENCES event ("key") ON DELETE CASCADE,
  FOREIGN KEY ("contact_key") REFERENCES contact ("key") ON DELETE CASCADE
);

DROP TABLE event_contacts;
ALTER TABLE event_contacts_new RENAME TO event_contacts;
CREATE INDEX "ix_event_contacts_event_key" ON event_contacts ("event_key" ASC);
CREATE INDEX "ix_event_contacts_contact_key" ON event_contacts ("contact_key" ASC);
