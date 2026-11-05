#!/usr/bin/env node
/* check-publish-empty.mjs — A5: 一个组件都不用的应用也能直接存版/发布，不拦不提示。 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NEG = process.argv.includes('--negctl');
let app = readFileSync(join(ROOT, 'assets', 'app.js'), 'utf8');
const data = readFileSync(join(ROOT, 'assets', 'data.js'), 'utf8');
function body(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
const GUARD = /comps\s*\.\s*length\s*(===?|!==?|<=?|>=?)\s*0|!\s*[a-z]*\.?comps\s*\.\s*length/i;
if (NEG) {
  const b = body(app, 'doPublish');
  if (!b) { console.log('负控注入失败：找不到 doPublish'); process.exit(1); }
  app = app.replace(b, b.replace('{', '{ if (!app.comps.length) { return; }'));
}
let bad = 0;
for (const t of ['doPublish', 'commitPublish']) {
  const b = body(app, t);
  if (!b) { console.log('缺少函数 ' + t); bad++; continue; }
  if (GUARD.test(b)) { console.log(t + ' 里出现按装配数量拦截的写法'); bad++; }
}
if (!/DB\.versSave\s*=\s*function/.test(data)) { console.log('data.js 里找不到 DB.versSave'); bad++; }
if (bad) { console.log('A5 失败：空装配应用必须能直接存版/发布，不许拦、不许提示。'); process.exit(2); }
console.log('A5 通过：doPublish/commitPublish 不按装配数量拦截，空应用可直接存版');
process.exit(0);
