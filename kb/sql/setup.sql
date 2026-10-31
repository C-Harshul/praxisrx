-- Governed KB writer only. Parameter :kb_namespace = verified catalog.schema.
-- No app_state migration or permissions changes. Records are append-only through the KB writer.
CREATE TABLE IF NOT EXISTS IDENTIFIER(:kb_namespace || '.kb_records') (
  record_type STRING NOT NULL,
  id STRING NOT NULL,
  version STRING NOT NULL,
  content_hash STRING NOT NULL,
  payload STRING NOT NULL,
  created_at TIMESTAMP NOT NULL
) USING DELTA TBLPROPERTIES ('delta.isolationLevel'='Serializable', 'delta.enableChangeDataFeed'='true', 'delta.appendOnly'='true');
