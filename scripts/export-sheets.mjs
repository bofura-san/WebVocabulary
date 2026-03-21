#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SHEET_ID = process.env.WV_SHEET_ID || "1AqqXZoShbq2OhnFW-lhUTlD0tIGlMPf8VNfOPcraNow";
const DEFAULT_GID = process.env.WV_DEFAULT_GID || "743650624";
const LIST_GID = process.env.WV_LIST_GID || "1137954113";
const OUTPUT_DIR = path.resolve(process.cwd(), process.env.WV_OUTPUT_DIR || "data");
const SHEET_OUTPUT_DIR = path.join(OUTPUT_DIR, "sheets");

function normalizeGid(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : "";
}

function buildSheetCsvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${normalizeGid(gid)}`;
}

async function loadCsv(gid) {
  const res = await fetch(buildSheetCsvUrl(gid), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load CSV for gid=${gid}: ${res.status}`);
  }
  return parseCsv(await res.text());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((currentRow) => currentRow.some((value) => String(value).trim() !== ""));
}

function mapRowToItem(rowLike) {
  let exampleEn = String(rowLike[4] ?? "").trim();
  let exampleJp = String(rowLike[5] ?? "").trim();
  if (!exampleEn && /[A-Za-z]/.test(exampleJp)) {
    exampleEn = exampleJp;
    exampleJp = String(rowLike[6] ?? "").trim();
  }
  return {
    id: String(rowLike[0] ?? "").trim(),
    en: String(rowLike[1] ?? "").trim(),
    jp: String(rowLike[2] ?? "").trim(),
    pos: String(rowLike[3] ?? "").trim(),
    exampleEn,
    exampleJp,
  };
}

function rowsToItems(rows) {
  const startIndex = rows.length > 0 && !/^\d+$/.test(String(rows[0][0]).trim()) ? 1 : 0;
  return rows
    .slice(startIndex)
    .map(mapRowToItem)
    .filter((item) => item.en && item.jp);
}

function rowsToSheetList(rows) {
  const startIndex = rows.length > 0 && !/^\d+$/.test(String(rows[0][1]).trim()) ? 1 : 0;
  return rows
    .slice(startIndex)
    .map((rowLike) => ({
      name: String(rowLike[0] ?? "").trim(),
      gid: normalizeGid(rowLike[1] ?? ""),
      hash: String(rowLike[2] ?? "").trim(),
      updatedAt: String(rowLike[3] ?? "").trim(),
    }))
    .filter((entry) => entry.name && entry.gid);
}

function createItemsHash(items) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

async function writeJson(filePath, value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, json, "utf8");
}

async function main() {
  await mkdir(SHEET_OUTPUT_DIR, { recursive: true });

  const generatedAt = new Date().toISOString();
  const listRows = await loadCsv(LIST_GID);
  const listEntries = rowsToSheetList(listRows);

  if (!listEntries.length) {
    throw new Error("No sheet entries were found in LST_GID.");
  }

  const sheets = [];

  for (const entry of listEntries) {
    const rows = await loadCsv(entry.gid);
    const items = rowsToItems(rows);
    const hash = createItemsHash(items);
    const payload = {
      generatedAt,
      sheetId: SHEET_ID,
      gid: entry.gid,
      name: entry.name,
      hash,
      itemCount: items.length,
      items,
    };

    await writeJson(path.join(SHEET_OUTPUT_DIR, `${entry.gid}.json`), payload);
    sheets.push({
      name: entry.name,
      gid: entry.gid,
      hash,
      itemCount: items.length,
      updatedAt: generatedAt,
    });
    console.log(`wrote data/sheets/${entry.gid}.json (${items.length} items)`);
  }

  const listPayload = {
    generatedAt,
    sheetId: SHEET_ID,
    defaultGid: DEFAULT_GID,
    listGid: LIST_GID,
    sheets,
  };

  await writeJson(path.join(OUTPUT_DIR, "list.json"), listPayload);
  console.log(`wrote data/list.json (${sheets.length} sheets)`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
