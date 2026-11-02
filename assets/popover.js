/* popover.js —— 浮层锚定：**一个定义，两页共用**（2026-10-26 立）
 *
 * 为什么有它：应用卡的菜单位置是 JS 算出来的（`placeMenu`），组件卡的菜单靠 CSS 绝对定位。
 * 结果是同一颗 ⋮ 在两页开出不同位置 —— CARDMENU 判据 ⑧c 实测「右缘差 153px」。
 * 这不是"两页风格不同"，是**同一个交互有两套实现**，迟早会对不上。
 *
 * 规则（照应用卡那套已验证的做法）：
 *   ① 贴着 ⋮ 的下沿开（+6），右缘与 ⋮ 对齐
 *   ② 下方放不下就翻到上面去
 *   ③ 不越出视口左右边界
 *   ④ 用 fixed 定位 + 显式 top/left，不赌 CSS 的 top/bottom
 *      （踩过：CSS 里写 top:calc(100%+6px) 且 bottom:auto，渲染出来 bottom 被解析成
 *        -120px 把 top 吃掉，菜单永远贴在卡片内 44px 处、盖住描述。）
 *
 * 用法：Popover.place(触发按钮, 菜单元素)
 */
(function () {
  function place(btn, menu) {
    if (!btn || !menu) return;
    var r = btn.getBoundingClientRect();
    var w = menu.offsetWidth || 168;
    var h = menu.offsetHeight || 0;
    var top = Math.round(r.bottom + 6);
    /* 下方不够就翻上去 */
    if (h && top + h > window.innerHeight - 8) top = Math.round(r.top - 6 - h);
    var left = Math.round(Math.min(r.right - w, window.innerWidth - w - 8));
    menu.style.position = 'fixed';
    menu.style.top = top + 'px';
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
  }
  window.Popover = { place: place };
})();
