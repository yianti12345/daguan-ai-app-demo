/* 达观智能审核平台 · 桌面客户端（Electron 主进程）
 *
 * 职责只有三件，别往里加：
 *   ① 开一个没有地址栏的窗口，加载**客户配置的服务器地址**；
 *   ② 记住这个地址（userData/config.json），首次启动让用户填；
 *   ③ 站内链接留在窗口里，站外链接交给系统浏览器 —— 客户端不该变成一个任意网页的外壳。
 *
 * 不做（要后端支持，现在做就是假的）：离线缓存、自动更新、多租户切换、托盘常驻。
 */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const PRODUCT = '达观智能审核平台';
const DEFAULT_URL = 'http://127.0.0.1:8941/apps.html';

app.setName(PRODUCT);

function confPath() { return path.join(app.getPath('userData'), 'config.json'); }
function readConf() {
  try { return JSON.parse(fs.readFileSync(confPath(), 'utf8')); } catch (e) { return {}; }
}
function writeConf(patch) {
  const next = Object.assign(readConf(), patch);
  try {
    fs.mkdirSync(path.dirname(confPath()), { recursive: true });
    fs.writeFileSync(confPath(), JSON.stringify(next, null, 2));
  } catch (e) { /* 写不进去下次还会问一遍，不拦住使用 */ }
  return next;
}
function serverUrl() {
  const u = String(readConf().server || '').trim();
  return /^https?:\/\//i.test(u) ? u : DEFAULT_URL;
}
function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }

let win = null;
let setupWin = null;

function internal(url) {
  const o = originOf(serverUrl());
  return !!o && originOf(url) === o;
}

function harden(wc) {
  /* 站外一律交给系统浏览器；站内照常。 */
  wc.setWindowOpenHandler(({ url }) => {
    if (internal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!internal(url)) { e.preventDefault(); shell.openExternal(url); }
  });
}

function openMain() {
  win = new BrowserWindow({
    /* 1440×900 是这套界面在浏览器里验过的那一档；更窄也能用，只是卡片里的信息会开始省略 */
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    title: PRODUCT,
    backgroundColor: '#f5f7fb',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  harden(win.webContents);
  win.loadURL(serverUrl());
  win.on('closed', () => { win = null; });
  return win;
}

function openSetup() {
  if (setupWin) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 520,
    height: 360,
    resizable: false,
    title: PRODUCT + ' · 服务器地址',
    icon: path.join(__dirname, 'icon.png'),
    parent: win || undefined,
    modal: !!win,
    webPreferences: { preload: path.join(__dirname, 'setup-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  setupWin.setMenuBarVisibility(false);
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => { setupWin = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const tpl = [
    ...(isMac ? [{
      label: PRODUCT,
      submenu: [
        { label: '关于 ' + PRODUCT, click: () => dialog.showMessageBox({
            type: 'info', title: '关于', message: PRODUCT,
            detail: '客户端 ' + app.getVersion() + '\n当前服务器：' + serverUrl(),
            buttons: ['好']
          }) },
        { type: 'separator' },
        { label: '服务器地址…', click: openSetup },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'quit', label: '退出 ' + PRODUCT }
      ]
    }] : []),
    {
      label: '查看',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
        { label: '回到首页', click: () => win && win.loadURL(serverUrl()) }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '服务器地址…', click: openSetup },
        { label: '在浏览器中打开', click: () => shell.openExternal(serverUrl()) },
        ...(!isMac ? [{ type: 'separator' }, { label: '关于', click: () => dialog.showMessageBox({
            type: 'info', title: '关于', message: PRODUCT,
            detail: '客户端 ' + app.getVersion() + '\n当前服务器：' + serverUrl(), buttons: ['好']
          }) }, { role: 'quit', label: '退出' }] : [])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* 设置页保存后走 IPC：preload 只暴露这两个通道，别的什么都不给 */
const { ipcMain } = require('electron');
ipcMain.handle('setup:get', () => ({ server: serverUrl(), version: app.getVersion() }));
ipcMain.handle('setup:save', (e, raw) => {
  const u = String(raw || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return { ok: false, msg: '请填写以 http:// 或 https:// 开头的地址' };
  writeConf({ server: u });
  if (setupWin) { setupWin.close(); }
  if (win) win.loadURL(u); else openMain();
  return { ok: true };
});

app.whenReady().then(() => {
  buildMenu();
  if (!readConf().server) openSetup(); else openMain();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) { if (!readConf().server) openSetup(); else openMain(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
