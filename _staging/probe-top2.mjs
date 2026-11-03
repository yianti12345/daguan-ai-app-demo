import { openMine } from '../tools/px-parity.mjs';
const b=await openMine('http://127.0.0.1:8941/app.html?id=ifas-mon');
await new Promise(r=>setTimeout(r,400));
console.log(await b.ev('JSON.stringify({kids:Array.from(document.querySelector(".topbar").children).map(function(c){return c.className}), prev:(function(){var els=Array.from(document.querySelectorAll("button,a"));var x=els.filter(function(e){return e.textContent.trim()==="预览"})[0];return x?x.parentElement.className+" | "+x.className:""})()})'));
b.close();