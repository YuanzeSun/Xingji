CREATE TABLE tickets_next (
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

INSERT INTO tickets_next (id, payload)
SELECT id, CASE WHEN json_type(payload, '$.deleted') = 'true' THEN
  json_object('id', id, 'deleted', json('true'), 'updatedAt', json_extract(payload, '$.updatedAt'))
ELSE json_remove(payload, '$.mergedIds') END
FROM tickets;

DROP TABLE tickets;
ALTER TABLE tickets_next RENAME TO tickets;

UPDATE archive_state SET head = lower(hex(randomblob(16))) WHERE singleton = 1;
