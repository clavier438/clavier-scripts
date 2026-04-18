// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: code;

const CLIENT_ID = "1079251834967-4kj1v0al6qcuuqdrhu4uagbsohc18sf2.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REFRESH_TOKEN = "1//0ePZih0kniL7eCgYIARAAGA4SNwF-L9IrMiGmojhKUrX65FNDGV4SOXdq6W2nMF3YQStWFGTWHkUy8gds5Dzho1vp-yypSkgYNjU";
const GDRIVE_FOLDER_NAME = "scriptsSync";

// env.md는 민감 정보 포함 — 동기화 제외
const EXCLUDE_FILES = ["env.md"];
const INCLUDE_EXTENSIONS = [".sh", ".js", ".md", ".json", ".plist", ".conf", ".txt"];

const fm = FileManager.iCloud();
const scriptsDir = fm.joinPath(fm.documentsDirectory(), "../../com~apple~CloudDocs/0/scripts");
const lf = FileManager.local();
const stateDir = lf.joinPath(lf.documentsDirectory(), "scriptsSync");
const statePath = lf.joinPath(stateDir, "state.json");

if (!lf.fileExists(stateDir)) lf.createDirectory(stateDir, true);

async function getAccessToken() {
  const req = new Request("https://oauth2.googleapis.com/token");
  req.method = "POST";
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  req.body = `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH_TOKEN}&grant_type=refresh_token`;
  const res = await req.loadJSON();
  if (!res.access_token) throw new Error("토큰 발급 실패: " + JSON.stringify(res));
  return res.access_token;
}

async function getFolderIdOrCreate(token, name, parentId = null) {
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const req = new Request(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  req.headers = { Authorization: `Bearer ${token}` };
  const res = await req.loadJSON();
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

async function uploadFile(token, localPath, name, parentId, existingFileId = null) {
  if (!fm.isFileDownloaded(localPath)) await fm.downloadFileFromiCloud(localPath);
  const content = fm.readString(localPath);
  const boundary = "boundary_scripts_sync";
  const metaJson = JSON.stringify(existingFileId ? {} : { name, parents: [parentId] });

  if (existingFileId) {
    const req = new Request(`https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`);
    req.method = "PATCH";
    req.headers = { Authorization: `Bearer ${token}`, "Content-Type": "text/plain; charset=utf-8" };
    req.body = content;
    await req.loadJSON();
  } else {
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${content}\r\n--${boundary}--`;
    const req = new Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart");
    req.method = "POST";
    req.headers = { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` };
    req.body = body;
    await req.loadJSON();
  }
}

async function listDriveFiles(token, folderId) {
  let files = {}, pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name)&pageSize=1000`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const req = new Request(url);
    req.headers = { Authorization: `Bearer ${token}` };
    const res = await req.loadJSON();
    for (const f of (res.files || [])) files[f.name] = f;
    pageToken = res.nextPageToken;
  } while (pageToken);
  return files;
}

function collectFiles(dir) {
  const results = [];
  let items;
  try { items = fm.listContents(dir); } catch { return results; }
  for (const item of items) {
    if (item.startsWith(".")) continue;
    if (EXCLUDE_FILES.includes(item)) continue;
    const fullPath = fm.joinPath(dir, item);
    if (fm.isDirectory(fullPath)) {
      results.push(...collectFiles(fullPath));
    } else {
      const ext = "." + item.split(".").pop();
      if (INCLUDE_EXTENSIONS.includes(ext)) results.push(fullPath);
    }
  }
  return results;
}

function loadState() {
  if (!lf.fileExists(statePath)) return {};
  try { return JSON.parse(lf.readString(statePath)); } catch { return {}; }
}
function saveState(state) {
  lf.writeString(statePath, JSON.stringify(state));
}

(async () => {
  const token = await getAccessToken();
  const rootFolderId = await getFolderIdOrCreate(token, GDRIVE_FOLDER_NAME);
  const driveFiles = await listDriveFiles(token, rootFolderId);
  const state = loadState();
  const files = collectFiles(scriptsDir);

  let uploaded = 0, skipped = 0;

  for (const localPath of files) {
    const rel = localPath.replace(scriptsDir, "").replace(/^\//, "");
    const name = rel.replace(/\//g, " ∕ ");
    const localMod = fm.modificationDate(localPath).getTime();
    const lastSynced = state[localPath];

    if (lastSynced && lastSynced >= localMod) { skipped++; continue; }

    const existing = driveFiles[name];
    await uploadFile(token, localPath, name, rootFolderId, existing?.id);
    state[localPath] = localMod;
    uploaded++;
  }

  saveState(state);
  const msg = `✅ scripts: ${uploaded}개 업로드, ${skipped}개 스킵`;
  console.log(msg);
  Script.setShortcutOutput(msg);
  Script.complete();
})();
