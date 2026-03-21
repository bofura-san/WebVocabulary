const LIST_SHEET_GID = 1137954113;
const LIST_HEADERS = ["name", "gid", "hash", "更新"];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("更新")
    .addItem("GitHubへ反映", "publishStaticDataToGitHub")
    .addItem("hash列を準備", "initializeListSheetMetadata")
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) {
    return;
  }

  const sheet = e.range.getSheet();
  const ss = sheet.getParent();
  const listSheet = getListSheet_(ss);
  if (!listSheet) {
    return;
  }

  if (String(sheet.getSheetId()) === String(listSheet.getSheetId())) {
    if (e.range.getRow() <= 1 || e.range.getColumn() > 2) {
      return;
    }
    markListRowDirty_(listSheet, e.range.getRow());
    return;
  }

  const rowIndex = findListRowByGid_(listSheet, String(sheet.getSheetId()));
  if (rowIndex > 1) {
    markListRowDirty_(listSheet, rowIndex);
  }
}

function initializeListSheetMetadata() {
  const listSheet = getListSheet_(SpreadsheetApp.getActiveSpreadsheet());
  if (!listSheet) {
    throw new Error("LST_GID sheet was not found.");
  }
  ensureListHeaders_(listSheet);
  SpreadsheetApp.getActiveSpreadsheet().toast("LST_GID の hash / 更新 列を準備しました。");
}

function publishStaticDataToGitHub() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listSheet = getListSheet_(ss);
  if (!listSheet) {
    throw new Error("LST_GID sheet was not found.");
  }

  ensureListHeaders_(listSheet);
  const entries = readListEntries_(listSheet);
  if (!entries.length) {
    throw new Error("LST_GID has no sheet entries.");
  }

  const generatedAt = new Date().toISOString();
  const config = getGitHubConfig_();
  const payloads = entries.map(function(entry) {
    return buildSheetPayload_(ss, entry, generatedAt);
  });

  let changedCount = 0;
  const listRows = [];

  for (let i = 0; i < payloads.length; i += 1) {
    const entry = entries[i];
    const payload = payloads[i];
    const needsUpload = entry.hash !== payload.hash || !entry.hash || entry.updatedAt === "要更新";
    const updatedAt = needsUpload ? generatedAt : (entry.updatedAt || "");

    if (needsUpload) {
      uploadJsonFile_(
        config,
        joinRepoPath_(config.basePath, `sheets/${payload.gid}.json`),
        payload,
        `Update vocabulary sheet ${payload.gid}`
      );
      changedCount += 1;
    }

    listRows.push({
      rowIndex: entry.rowIndex,
      hash: payload.hash,
      updatedAt: updatedAt,
      sheet: {
        name: payload.name,
        gid: payload.gid,
        hash: payload.hash,
        itemCount: payload.itemCount,
        updatedAt: updatedAt,
      },
    });
  }

  const listPayload = {
    generatedAt: generatedAt,
    sheetId: ss.getId(),
    defaultGid: getDefaultGid_(entries),
    listGid: String(listSheet.getSheetId()),
    sheets: listRows.map(function(row) { return row.sheet; }),
  };

  uploadJsonFile_(
    config,
    joinRepoPath_(config.basePath, "list.json"),
    listPayload,
    `Update vocabulary list (${generatedAt})`
  );

  listRows.forEach(function(row) {
    listSheet.getRange(row.rowIndex, 3, 1, 2).setValues([[row.hash, row.updatedAt]]);
  });

  SpreadsheetApp.getActiveSpreadsheet().toast(`GitHubへ ${changedCount} シート反映しました。`);
}

function getListSheet_(ss) {
  const configuredGid = Number(getOptionalScriptProperty_("WV_LIST_GID", String(LIST_SHEET_GID)));
  const byId = ss.getSheets().find(function(sheet) {
    return Number(sheet.getSheetId()) === configuredGid;
  });
  if (byId) {
    return byId;
  }
  return ss.getSheetByName("LST_GID");
}

function ensureListHeaders_(listSheet) {
  listSheet.getRange(1, 1, 1, LIST_HEADERS.length).setValues([LIST_HEADERS]);
}

function readListEntries_(listSheet) {
  const values = listSheet.getDataRange().getDisplayValues();
  const startIndex = values.length > 0 && !/^\d+$/.test(String(values[0][1] || "").trim()) ? 1 : 0;

  return values
    .slice(startIndex)
    .map(function(rowLike, index) {
      return {
        rowIndex: startIndex + index + 1,
        name: String(rowLike[0] || "").trim(),
        gid: normalizeGid_(rowLike[1] || ""),
        hash: String(rowLike[2] || "").trim(),
        updatedAt: String(rowLike[3] || "").trim(),
      };
    })
    .filter(function(entry) {
      return entry.name && entry.gid;
    });
}

function findListRowByGid_(listSheet, gid) {
  const entries = readListEntries_(listSheet);
  const found = entries.find(function(entry) {
    return entry.gid === normalizeGid_(gid);
  });
  return found ? found.rowIndex : -1;
}

function markListRowDirty_(listSheet, rowIndex) {
  if (rowIndex <= 1) {
    return;
  }
  listSheet.getRange(rowIndex, 3, 1, 2).setValues([["", "要更新"]]);
}

function buildSheetPayload_(ss, entry, generatedAt) {
  const sheet = getSheetByGid_(ss, entry.gid);
  if (!sheet) {
    throw new Error(`Sheet gid=${entry.gid} was not found.`);
  }

  const values = sheet.getDataRange().getDisplayValues();
  const items = rowsToItems_(values);
  const hash = computeHash_(items);

  return {
    generatedAt: generatedAt,
    sheetId: ss.getId(),
    gid: entry.gid,
    name: entry.name || sheet.getName(),
    hash: hash,
    itemCount: items.length,
    items: items,
  };
}

function getSheetByGid_(ss, gid) {
  const normalized = normalizeGid_(gid);
  return ss.getSheets().find(function(sheet) {
    return String(sheet.getSheetId()) === normalized;
  }) || null;
}

function rowsToItems_(rows) {
  const startIndex = rows.length > 0 && !/^\d+$/.test(String(rows[0][0] || "").trim()) ? 1 : 0;
  return rows
    .slice(startIndex)
    .map(function(rowLike) {
      let exampleEn = String(rowLike[4] || "").trim();
      let exampleJp = String(rowLike[5] || "").trim();
      if (!exampleEn && /[A-Za-z]/.test(exampleJp)) {
        exampleEn = exampleJp;
        exampleJp = String(rowLike[6] || "").trim();
      }
      return {
        id: String(rowLike[0] || "").trim(),
        en: String(rowLike[1] || "").trim(),
        jp: String(rowLike[2] || "").trim(),
        pos: String(rowLike[3] || "").trim(),
        exampleEn: exampleEn,
        exampleJp: exampleJp,
      };
    })
    .filter(function(item) {
      return item.en && item.jp;
    });
}

function computeHash_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byteValue) {
    const normalized = byteValue < 0 ? byteValue + 256 : byteValue;
    return (`0${normalized.toString(16)}`).slice(-2);
  }).join("");
}

function getDefaultGid_(entries) {
  return normalizeGid_(
    getOptionalScriptProperty_("WV_DEFAULT_GID", entries.length ? entries[0].gid : "")
  );
}

function getGitHubConfig_() {
  return {
    owner: getRequiredScriptProperty_("GITHUB_OWNER"),
    repo: getRequiredScriptProperty_("GITHUB_REPO"),
    branch: getOptionalScriptProperty_("GITHUB_BRANCH", "main"),
    token: getRequiredScriptProperty_("GITHUB_TOKEN"),
    basePath: getOptionalScriptProperty_("WV_DATA_BASE_PATH", "data"),
  };
}

function getRequiredScriptProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(`Script property ${key} is required.`);
  }
  return value;
}

function getOptionalScriptProperty_(key, fallbackValue) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value || fallbackValue;
}

function uploadJsonFile_(config, repoPath, value, message) {
  const json = JSON.stringify(value, null, 2) + "\n";
  const existingSha = getFileSha_(config, repoPath);
  const body = {
    message: message,
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
    branch: config.branch,
  };

  if (existingSha) {
    body.sha = existingSha;
  }

  const response = UrlFetchApp.fetch(buildContentsApiUrl_(config, repoPath), {
    method: "put",
    contentType: "application/json",
    headers: buildGitHubHeaders_(config.token),
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`GitHub upload failed for ${repoPath}: ${code} ${response.getContentText()}`);
  }
}

function getFileSha_(config, repoPath) {
  const response = UrlFetchApp.fetch(
    `${buildContentsApiUrl_(config, repoPath)}?ref=${encodeURIComponent(config.branch)}`,
    {
      method: "get",
      headers: buildGitHubHeaders_(config.token),
      muteHttpExceptions: true,
    }
  );

  const code = response.getResponseCode();
  if (code === 404) {
    return "";
  }
  if (code < 200 || code >= 300) {
    throw new Error(`GitHub lookup failed for ${repoPath}: ${code} ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText()).sha || "";
}

function buildContentsApiUrl_(config, repoPath) {
  const encodedPath = repoPath
    .split("/")
    .filter(function(part) { return part; })
    .map(function(part) { return encodeURIComponent(part); })
    .join("/");

  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`;
}

function buildGitHubHeaders_(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function joinRepoPath_(basePath, leafPath) {
  const left = String(basePath || "").replace(/\/+$/, "");
  const right = String(leafPath || "").replace(/^\/+/, "");
  return [left, right].filter(function(part) { return part; }).join("/");
}

function normalizeGid_(value) {
  const match = String(value || "").match(/\d+/);
  return match ? match[0] : "";
}
