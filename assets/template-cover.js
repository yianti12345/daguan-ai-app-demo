/* 将当前画布渲染为卡片尺寸的图片。HTML 模版继续在禁止脚本的沙箱中绘制。 */
(function(){
 'use strict';

 function loadPreview(frame,source){
  return new Promise(function(resolve,reject){
   var timer=setTimeout(function(){reject(new Error('页面预览加载超时'));},3000);
   frame.onload=function(){clearTimeout(timer);resolve();};
   frame.srcdoc=source;
   document.body.appendChild(frame);
  });
 }

 async function capture(host){
  if(!host||!host.children.length||host.querySelector('.cv-empty'))return '';
  var target=host,temporary=null;
  try{
   var preview=host.querySelector('.af-content iframe');
   if(preview){
    temporary=document.createElement('iframe');
    temporary.setAttribute('sandbox','allow-same-origin');
    temporary.setAttribute('aria-hidden','true');
    temporary.tabIndex=-1;
    temporary.className='template-cover-capture';
    temporary.width=Math.round(preview.getBoundingClientRect().width);
    temporary.height=Math.round(preview.getBoundingClientRect().height);
    await loadPreview(temporary,preview.srcdoc);
    target=temporary.contentDocument.documentElement;
   }
   var width=Math.round(target.getBoundingClientRect().width);
   if(width<1)throw new Error('画布当前不可见');
   var canvas=await html2canvas(target,{
    width:width,height:Math.round(width/2.3),scale:Math.min(1,960/width),
    backgroundColor:'#fff',logging:false,imageTimeout:1800
   });
   for(var quality of [0.84,0.64,0.44]){
    var image=CAP.Templates.coverImage(canvas.toDataURL('image/jpeg',quality));
    if(image)return image;
   }
   throw new Error('封面截图过大');
  }finally{
   if(temporary)temporary.remove();
  }
 }

 window.TemplateCover={capture:capture};
})();
