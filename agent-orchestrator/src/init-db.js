import { openDatabase } from './db.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function initSchema(db) {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url).href) {
  const { db, dbPath } = openDatabase();
  initSchema(db);
  console.log(`Initialized sqlite db at: ${dbPath}`);
  db.close();
}
