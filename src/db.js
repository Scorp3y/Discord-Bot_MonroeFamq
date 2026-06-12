import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'applications.json');

async function ensureDb() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(DB_FILE, 'utf8');
  } catch {
    await writeFile(DB_FILE, JSON.stringify({ applications: {} }, null, 2), 'utf8');
  }
}

export async function readDb() {
  await ensureDb();
  const raw = await readFile(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

export async function writeDb(db) {
  await ensureDb();
  await writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

export async function saveApplication(reviewMessageId, data) {
  const db = await readDb();
  db.applications[reviewMessageId] = {
    ...data,
    reviewMessageId,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  await writeDb(db);
}

export async function updateApplication(reviewMessageId, patch) {
  const db = await readDb();
  const current = db.applications[reviewMessageId] || {};
  db.applications[reviewMessageId] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return db.applications[reviewMessageId];
}

export async function getApplication(reviewMessageId) {
  const db = await readDb();
  return db.applications[reviewMessageId] || null;
}
