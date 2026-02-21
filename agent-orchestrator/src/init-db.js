import { openDatabase } from './db.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { db, dbPath } = openDatabase();
const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
const schema = readFileSync(schemaPath, 'utf8');

db.exec(schema);
console.log(`Initialized sqlite db at: ${dbPath}`);
db.close();
