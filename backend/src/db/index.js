import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureUserVerificationColumns } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'schema.sql');

let db;

function resolveDbPath() {
  const configuredPath = process.env.DATABASE_PATH || './data/app.db';
  return path.resolve(process.cwd(), configuredPath);
}

function ensureDataDirectory(dbPath) {
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function openDatabase() {
  if (db) {
    return db;
  }

  const dbPath = resolveDbPath();
  ensureDataDirectory(dbPath);

  db = new sqlite3.Database(dbPath);
  return db;
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    openDatabase().exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function initializeDb() {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await exec(schema);
  await ensureUserVerificationColumns(openDatabase());
}

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().run(sql, params, function handleRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

export function closeDb() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }

    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      db = undefined;
      resolve();
    });
  });
}
