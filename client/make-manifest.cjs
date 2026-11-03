/* make-manifest.cjs —— 生成 downloads/manifest.json（下载页唯一的数据源）。
 *
 * 页面上不写死版本号、大小、校验值：它们全部由这里从**实际打出来的文件**现算，
 * 重新打包后页面自动跟着变，不会出现"页上说 1.0.0、包里是 1.0.1"。
 *
 * 用法：node make-manifest.cjs <版本号> <downloads 目录>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ver = process.argv[2];
const out = process.argv[3];
if (!ver || !out) { console.error('用法: node make-manifest.cjs <版本> <downloads 目录>'); process.exit(2); }

const sha256 = (p) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(p).on('data', (b) => h.update(b)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

const SPEC = [
  {
    key: 'mac',
    file: `达观智能审核平台-${ver}-mac-arm64.dmg`,
    ext: '.dmg',
    os: 'macOS',
    arch: 'Apple 芯片（M1 及以后）',
    requires: 'macOS 12 或更高',
    how: '打开 .dmg，把「达观智能审核平台」拖进「应用程序」。'
  },
  {
    key: 'win',
    file: `达观智能审核平台-${ver}-windows-x64.zip`,
    ext: '.zip',
    os: 'Windows',
    arch: '64 位（x64）',
    requires: 'Windows 10 或更高',
    how: '解压后双击「达观智能审核平台.exe」。绿色版，不用安装。'
  }
];

(async () => {
  const files = [];
  for (const s of SPEC) {
    const p = path.join(out, s.file);
    if (!fs.existsSync(p)) { console.log('  · 跳过（还没打包）：' + s.file); continue; }
    files.push(Object.assign({}, s, {
      name: s.file,
      version: ver,
      size: fs.statSync(p).size,
      sha256: await sha256(p),
      href: 'downloads/' + s.file
    }));
  }
  if (!files.length) { console.error('✗ 一个安装包都没有，manifest 不写'); process.exit(1); }
  const m = { version: ver, at: new Date().toISOString(), files };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  console.log('  ✓ manifest.json（' + files.length + ' 个包）');
})().catch((e) => { console.error(e); process.exit(1); });
