CREATE TABLE archive_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  id TEXT NOT NULL,
  head TEXT NOT NULL,
  generation TEXT NOT NULL,
  settings TEXT NOT NULL
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 100 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  payload TEXT NOT NULL CHECK (
    json_valid(payload)
    AND json_type(payload, '$.id') IS 'text'
    AND json_extract(payload, '$.id') = id
    AND CASE WHEN json_type(payload, '$.deleted') = 'true' THEN
      json_type(payload, '$.updatedAt') IS 'text'
      AND json_remove(payload, '$.id', '$.deleted', '$.updatedAt') = '{}'
    ELSE
      json_type(payload, '$.mergedIds') IS NULL
      AND (json_extract(payload, '$.type') IS 'rail' OR json_extract(payload, '$.type') IS 'flight')
    END
  )
);

INSERT INTO archive_state (singleton, id, head, generation, settings)
VALUES (1, lower(hex(randomblob(16))), lower(hex(randomblob(16))), '', '{}');
