import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'applications.json');

const DEFAULT_DB = {
  applications: {},
  settings: {
    applicationsOpen: true,
    panelChannelId: null,
    panelMessageId: null
  }
};

async function ensureDb() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await readFile(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    let changed = false;

    if (!db.applications) {
      db.applications = {};
      changed = true;
    }

    if (!db.settings) {
      db.settings = { ...DEFAULT_DB.settings };
      changed = true;
    }

    if (typeof db.settings.applicationsOpen !== 'boolean') {
      db.settings.applicationsOpen = true;
      changed = true;
    }

    if (!Object.prototype.hasOwnProperty.call(db.settings, 'panelChannelId')) {
      db.settings.panelChannelId = null;
      changed = true;
    }

    if (!Object.prototype.hasOwnProperty.call(db.settings, 'panelMessageId')) {
      db.settings.panelMessageId = null;
      changed = true;
    }

    if (changed) await writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch {
    await writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
  }
}

export async function readDb() {
  await ensureDb();
  const raw = await readFile(DB_FILE, 'utf8');
  const db = JSON.parse(raw);
  db.applications ||= {};
  db.settings ||= { ...DEFAULT_DB.settings };
  return db;
}

export async function writeDb(db) {
  await ensureDb();
  db.applications ||= {};
  db.settings ||= { ...DEFAULT_DB.settings };
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

export async function countPendingApplicationsByApplicant(applicantId) {
  const db = await readDb();
  return Object.values(db.applications).filter(
    (application) =>
      application?.applicantId === applicantId &&
      application?.status === 'pending'
  ).length;
}

export async function getSettings() {
  const db = await readDb();
  return {
    ...DEFAULT_DB.settings,
    ...(db.settings || {})
  };
}

export async function updateSettings(patch) {
  const db = await readDb();
  db.settings = {
    ...DEFAULT_DB.settings,
    ...(db.settings || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await writeDb(db);
  return db.settings;
}
