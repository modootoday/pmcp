export const ENTRY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS entry_vector (
    name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    dims INTEGER NOT NULL,
    description_hash TEXT NOT NULL,
    vector BLOB NOT NULL,
    PRIMARY KEY (name, model_id)
  );
`;
export const TRANSFORMERS = "@huggingface/transformers";
