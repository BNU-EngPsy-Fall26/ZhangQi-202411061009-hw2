/* ============================================================
   config.js —— 全局配置
   ============================================================ */
const CONFIG = {
  // ★ 项目码（已在注意实验室 /hw2 创建项目：2026-11-06）
  //   链接参数 ?project=XXXXXX 可覆盖此值；?test=1 会给 experiment 名加 test_ 前缀（调试数据与正式数据分离）
  PROJECT_CODE: "6DKEZT",
  // 收数接口（行为已实测核对：成功 {ok:true, record_id, warnings?}；码错 404+msg；CORS 全开）
  API_SUBMIT: "https://attention-lab-production.up.railway.app/api/hw2/submit",
  // 读回全体匿名数据（结果页「从收数接口读取」按钮用；被试名自动匿名为 P01、P02…）
  API_DATA: "https://attention-lab-production.up.railway.app/api/hw2/data",
  // 收数失败时的本地兜底：数据仍会存 localStorage 并可导出 CSV
  EYE_TRACKING_DEFAULT: true, // 默认询问是否开启摄像头眼动
};
