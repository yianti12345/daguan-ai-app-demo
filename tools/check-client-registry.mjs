#!/usr/bin/env node
/* check-client-registry.mjs — 授权是「应用 × 客户」的多对多记录（2026-11-02 第二次改，用户 m01548）。
   背景：m01548 定下的模型 —— 一个应用可授权多个客户，每个客户记当时授权的版本；
   新增授权和升级版本都默认取当前应用的最新版本。
   第一版判据（客户是全局台账、应用挂一个 clientId）已被真实系统推翻，这里整体换掉。

   判据只认机器形态：
   1) 数据层：AUTH_FIELDS / DB.AUTHS / persistRaw 写 auths / loadAuths 读 s.auths；
   2) 版本默认最新：authGrant 里版本必须取自 latestVer（不许从入参里收版本号）；
   3) 页面：客户授权页多选客户（#fm-clients）、版本只读（#fm-ver-note），没有选版本的 select；
   4) 应用侧：应用表单没有「所属客户」字段（#ap-client 不存在），createApp 不再带 clientId。
   --negctl：往 apps.html 注回 select#ap-client，必须 rc=2。 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NEG = process.argv.includes('--negctl');
let apps = readFileSync(join(ROOT, 'apps.html'), 'utf8');
const ca = readFileSync(join(ROOT, 'client-auth.html'), 'utf8');
const cajs = readFileSync(join(ROOT, 'assets', 'client-auth.js'), 'utf8');
const data = readFileSync(join(ROOT, 'assets', 'data.js'), 'utf8');
if (NEG) {
  apps = apps.replace('<div class="nf-bd">', '<div class="nf-bd"><select id="ap-client"></select>');
  if (!/id="ap-client"/.test(apps)) { console.log('负控注入失败：apps.html 里找不到 nf-bd 锚点'); process.exit(1); }
}
let bad = 0;
const fail = (m) => { console.log(m); bad++; };

/* ① 数据层 */
if (!/AUTH_FIELDS/.test(data)) fail('assets/data.js：没有 AUTH_FIELDS（授权记录不在 schema 白名单，刷新就丢）');
if (data.indexOf('AUTHS: []') < 0) fail('assets/data.js：没有 DB.AUTHS');
if (data.indexOf('auths: DB.AUTHS') < 0) fail('assets/data.js：persistRaw 没写 auths');
if (!/loadAuths\(/.test(data)) fail('assets/data.js：没有 loadAuths（老存档迁不进来）');
if (!/\bs\.auths\b/.test(data)) fail('assets/data.js：load 没读 s.auths');
/* ② 版本默认最新：授权/升级都不许收版本号入参 */
if (!/DB\.latestVer\s*=/.test(data)) fail('assets/data.js：没有 DB.latestVer');
if (!/DB\.authGrant\s*=\s*function\s*\(\s*appId\s*,\s*clientIds\s*,\s*months\s*,\s*at\s*\)/.test(data))
  fail('assets/data.js：DB.authGrant 签名变了 —— 版本不许从入参收，必须只有 (appId, clientIds, months, at)');
if (!/version:\s*v\b|version:\s*latestVer/.test(data)) fail('assets/data.js：authGrant 没把最新版写进记录');
if (!/DB\.authUpgrade\s*=/.test(data)) fail('assets/data.js：没有 DB.authUpgrade（升级只能改这一条记录）');
/* ③ 客户授权页：多选客户 + 版本只读 */
if (!/id="fm-clients"/.test(ca)) fail('client-auth.html：没有客户多选容器 #fm-clients');
if (!/id="fm-ver-note"/.test(ca)) fail('client-auth.html：没有版本只读提示 #fm-ver-note');
if (/id="fm-ver"/.test(ca)) fail('client-auth.html：#fm-ver 又回来了 —— 版本不给选（用户 m01548）');
if (/id="fm-tenant"/.test(ca)) fail('client-auth.html：#fm-tenant 又回来了 —— 租户 ID 从客户台账来，不手填');
if (!/DB\.authGrant\(/.test(cajs)) fail('assets/client-auth.js：提交没走 DB.authGrant');
if (!/DB\.authUpgrade\(/.test(cajs)) fail('assets/client-auth.js：升级没走 DB.authUpgrade');
if (!/fm-clients/.test(cajs)) fail('assets/client-auth.js：没画客户多选列表');
/* ④ 应用侧：字段撤掉 */
if (/id="ap-client"/.test(apps)) fail('apps.html：#ap-client 又出现了 —— 应用不挂单一客户（一应用可授多家）');
if (/clientId\s*:/.test(apps)) fail('apps.html：提交又带 clientId 了 —— 应用不再持有客户');
if (!/DB\.authRows\(/.test(apps)) fail('apps.html：卡面没读授权记录（DB.authRows）—— 家数/待升级只能从授权表来');

if (bad) { console.log('客户授权判据失败：' + bad + ' 处。授权必须是「应用 × 客户」多条记录，每家有自己那一版，新增/升级默认最新。'); process.exit(2); }
console.log('客户授权判据通过：AUTH_FIELDS/DB.AUTHS/auths 持久化齐，authGrant 只收 appId+clientIds+月数+日期（版本取 latestVer），authUpgrade 单条升级；客户授权页多选 #fm-clients、版本只读 #fm-ver-note；apps.html 无 #ap-client 且卡面读 DB.authRows');
process.exit(0);
