import { openMine } from '../tools/px-parity.mjs';
const b=await openMine('http://127.0.0.1:8941/app.html?id=ifas-mon');
await new Promise(r=>setTimeout(r,500));
const m=await b.ev('(function(){var s=document.querySelector(".sheet").getBoundingClientRect(),n=document.querySelector(".mon").getBoundingClientRect(),v=document.querySelector(".mon-nav").getBoundingClientRect(),c=document.querySelector("#canvas");return {sys:document.body.getAttribute("data-sys"),vw:innerWidth,sheet:[s.left,s.width],mon:[n.left,n.width,n.height],navLeft:v.left,pad:getComputedStyle(c).paddingLeft+"/"+getComputedStyle(c).paddingRight}})()');
console.log(JSON.stringify(m)); b.close();