import { openMine } from '../tools/px-parity.mjs';
const b=await openMine('http://127.0.0.1:8941/app.html?id=ifas-mon');
await new Promise(r=>setTimeout(r,400));
console.log(await b.ev('document.querySelector(".tb-ops").outerHTML.slice(0,900)'));
b.close();