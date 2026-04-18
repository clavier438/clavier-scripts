// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: cloud-upload-alt;

const CLIENT_ID = "1079251834967-4kj1v0al6qcuuqdrhu4uagbsohc18sf2.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REFRESH_TOKEN = "1//0ePZih0kniL7eCgYIARAAGA4SNwF-L9IrMiGmojhKUrX65FNDGV4SOXdq6W2nMF3YQStWFGTWHkUy8gds5Dzho1vp-yypSkgYNjU";
const GDRIVE_FOLDER_NAME = "obsidianSync";

const fm = FileManager.iCloud();

// Obsidian vault: /Mobile Documents/iCloud~md~obsidian~obsidian/Documents/{vault}/
// Scriptable docs: /Mobile Documents/iCloud~dk~simonbs~scriptable/Documents
const _mobileDocs = fm.documentsDirectory().replace(/\/iCloud~dk~simonbs~scriptable\/Documents$/, "");
const _obsidianBase = _mobileDocs + "/iCloud~md~obsidian~obsidian/Documents";
const _vaultItems = fm.listContents(_obsidianBase).filter(n => !n.startsWith("."));
if (_vaultItems.length === 0) throw new Error("Obsidian vault를 찾을 수 없음: " + _obsidianBase);
const vaultDir = _obsidianBase + "/" + _vaultItems[0];

const stateDir = fm.joinPath(FileManager.local().documentsDirectory(), "obsidianSync");
const statePath = FileManager.local().joinPath(stateDir, "state.json");

if (!FileManager.local().fileExists(stateDir)) {
  FileManager.local().createDirectory(stateDir, true);
}

// ── Access Token ──────────────────────────────────────────────
async function getAccessToken() {
  const req = new Request("https://oauth2.googleapis.com/token");
  req.method = "POST";
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  req.body = `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH_TOKEN}&grant_type=refresh_token`;
  const res = await req.loadJSON();
  if (!res.access_token) throw new Error("토큰 발급 실패: " + JSON.stringify(res));
  return res.access_token;
}

// ── Google Drive 폴더 ID 확보 ─────────────────────────────────
async function getFolderIdOrCreate(token, name, parentId = null) {
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const search = new Request(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  search.headers = { Authorization: `Bearer ${token}` };
  const res = await search.loadJSON();
  if (res.files && res.files.length > 0) return res.files[0].id;

  const create = new Request("https://www.googleapis.com/drive/v3/files");
  create.method = "POST";
  create.headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const meta = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) meta.parents = [parentId];
  create.body = JSON.stringify(meta);
  const created = await create.loadJSON();
  return created.id;
}

// ── 파일 업로드 (없으면 생성, 있으면 업데이트) ────────────────
async function uploadFile(token, localPath, name, parentId, existingFileId = null) {
  if (!fm.isFileDownloaded(localPath)) {
    await fm.downloadFileFromiCloud(localPath);
  }
  const content = fm.read(localPath);

  if (existingFileId) {
    const req = new Request(`https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`);
    req.method = "PATCH";
    req.headers = { Authorization: `Bearer ${token}`, "Content-Type": "text/markdown" };
    req.body = content;
    await req.loadJSON();
  } else {
    const boundary = "boundary_obsidian_sync";
    const metaJson = JSON.stringify({ name, parents: [parentId] });
    const bodyStr = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: text/markdown\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;

    const req = new Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart");
    req.method = "POST";
    req.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    };
    const bodyData = Data.fromString(bodyStr);
    const tailData = Data.fromString(tail);
    req.body = bodyData.toRawString() + fm.readString(localPath) + tail;
    // multipart 직접 구성
    req.body = bodyStr + fm.readString(localPath) + tail;
    await req.loadJSON();
  }
}

// ── 폴더 내 파일 목록 조회 ────────────────────────────────────
async function listDriveFiles(token, folderId) {
  let files = {}, pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=1000`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const req = new Request(url);
    req.headers = { Authorization: `Bearer ${token}` };
    const res = await req.loadJSON();
    for (const f of (res.files || [])) files[f.name] = f;
    pageToken = res.nextPageToken;
  } while (pageToken);
  return files;
}

// ── 로컬 md 파일 수집 ─────────────────────────────────────────
function collectMdFiles(dir) {
  const results = [];
  const items = fm.listContents(dir);
  for (const item of items) {
    if (item.startsWith(".")) continue;
    const fullPath = fm.joinPath(dir, item);
    if (fm.isDirectory(fullPath)) {
      results.push(...collectMdFiles(fullPath));
    } else if (item.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── state 로드/저장 ───────────────────────────────────────────
function loadState() {
  const lf = FileManager.local();
  if (!lf.fileExists(statePath)) return {};
  try { return JSON.parse(lf.readString(statePath)); } catch { return {}; }
}
function saveState(state) {
  FileManager.local().writeString(statePath, JSON.stringify(state));
}

// ── 메인 ─────────────────────────────────────────────────────
(async () => {
  const token = await getAccessToken();
  const rootFolderId = await getFolderIdOrCreate(token, GDRIVE_FOLDER_NAME);
  const driveFiles = await listDriveFiles(token, rootFolderId);
  const state = loadState();
  const mdFiles = collectMdFiles(vaultDir);

  let uploaded = 0, skipped = 0;

  for (const localPath of mdFiles) {
    const name = localPath.replace(vaultDir, "").replace(/^\//, "").replace(/\//g, " ∕ ");
    const localMod = fm.modificationDate(localPath).getTime();
    const lastSynced = state[localPath];

    if (lastSynced && lastSynced >= localMod) { skipped++; continue; }

    const existing = driveFiles[name];
    await uploadFile(token, localPath, name, rootFolderId, existing?.id);
    state[localPath] = localMod;
    uploaded++;
  }

  saveState(state);
  const msg = `✅ ${uploaded}개 업로드, ${skipped}개 스킵`;
  console.log(msg);
  Script.setShortcutOutput(msg);
  Script.complete();
})();
