import { openMine } from '../tools/px-parity.mjs';
for (const p of ['app.html?id=zxjt-yy','app.html?id=hx-zc','app.html?id=ifas-mon','component.html?id=task-list']) {
  const b=await openMine('http://127.0.0.1:8941/'+p);
  await new Promise(r=>setTimeout(r,350));
  const t=await b.ev('(document.querySelector("#canvas").innerText||"").slice(0,40).split(String.fromCharCode(10)).join(" ")');
  console.log(p, '=>', t);
  b.close();
}