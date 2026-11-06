CREATE TABLE note_new (
  "key" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "heading" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("heading", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  "text" TEXT NOT NULL COLLATE RTRIM
    CHECK (length(trim("text", char(9) || char(10) || char(11) || char(12) || char(13) || char(32))) > 0),
  PRIMARY KEY ("key")
);

INSERT INTO note_new ("key", "version", "created_at", "heading", "text")
SELECT
  "key",
  "version",
  strftime('%Y-%m-%dT%H:%M:%fZ', "created_at"),
  "heading",
  "text"
FROM note;

DROP TABLE note;
ALTER TABLE note_new RENAME TO note;
