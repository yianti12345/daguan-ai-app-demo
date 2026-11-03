/* brand-win.cjs —— 给 Windows 版 electron.exe 换上我们的图标与版本信息。
 *
 * 为什么需要它：Electron 的 exe 默认图标是 Electron 的；换图标的标准做法 rcedit 是个
 * Windows 程序，在 macOS 上要 wine。resedit 是纯 JS 的 PE 资源编辑器，能直接改图标组
 * 与版本信息，不需要任何 Windows 工具链。
 *
 * 用法：node brand-win.cjs <解压出来的 win 目录>   （build.sh 会调）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('resedit/cjs');

const PRODUCT = '达观智能审核平台';
const COMPANY = '达观数据';
const VERSION = require('./package.json').version;

(async () => {
  const { NtExecutable, NtExecutableResource, Resource, Data } = await load();
  const dir = process.argv[2];
  if (!dir) { console.error('用法: node brand-win.cjs <win 目录>'); process.exit(2); }

  const exePath = path.join(dir, 'electron.exe');
  const nt = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(nt);

  const icons = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons.icons.map((i) => i.data));

  const vis = Resource.VersionInfo.fromEntries(res.entries);
  if (vis && vis.length) {
    vis[0].setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: PRODUCT,
      FileDescription: PRODUCT,
      CompanyName: COMPANY,
      LegalCopyright: '© 2026 ' + COMPANY,
      ProductVersion: VERSION,
      FileVersion: VERSION + '.0',
      InternalName: 'daguan-client',
      OriginalFilename: PRODUCT + '.exe'
    });
    vis[0].outputToResourceEntries(res.entries);
  }
  res.outputResource(nt);

  const out = path.join(dir, PRODUCT + '.exe');
  fs.writeFileSync(out, Buffer.from(nt.generate()));
  fs.unlinkSync(exePath);
  console.log('  ✓ ' + path.basename(out));
})().catch((e) => { console.error(e); process.exit(1); });
