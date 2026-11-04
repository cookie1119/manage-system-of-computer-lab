/* 云端配置：Supabase 项目的地址与公开密钥。
   这两项本来就是设计成放在前端的（可公开），真正的门锁是「登录 + 行级权限」。
   换成别的项目时只改这里，其它代码不用动。 */
window.CLOUD_CONFIG = {
  enabled: true,
  url: 'https://yxwkbedujksxxgqybtkt.supabase.co',
  key: 'sb_publishable_c3CfLnUp0vQtX-u-R237PQ_19q_KHTM',
  table: 'app_data'
};
