'use strict';
// FAQ はネイティブの <details> を使用。JavaScript は任意の補助機能に限定。
// 外部サービスへの通信・解析タグ・自動送信は行いません。
document.querySelectorAll('.questions details').forEach((item) => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    document.querySelectorAll('.questions details').forEach((other) => {
      if (other !== item) other.open = false;
    });
  });
});
