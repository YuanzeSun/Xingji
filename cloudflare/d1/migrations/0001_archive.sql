CREATE TABLE archive_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  id TEXT NOT NULL,
  head TEXT NOT NULL,
  generation TEXT NOT NULL,
  settings TEXT NOT NULL
);

INSERT INTO archive_state VALUES (1, lower(hex(randomblob(16))), '0', '', '{}');

CREATE TABLE tickets (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL
);
