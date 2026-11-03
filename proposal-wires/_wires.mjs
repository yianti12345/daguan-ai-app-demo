/* 临时：三张灰阶线框截图（供零上下文盲评）。 */
import { resolveBase } from './base.mjs';
import { openMine } from './px-parity.mjs';

const BASE = await resolveBase([]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const v of ['a', 'b', 'c']) {
  const m = await openMine(`${BASE}/proposal-wires/wire-${v}.html`);
  await sleep(700);
  await m.shot(`/tmp/wire-${v}.png`);
  console.log(`shot → /tmp/wire-${v}.png`);
  m.close();
}
