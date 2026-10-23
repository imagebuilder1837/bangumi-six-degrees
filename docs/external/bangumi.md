# Bangumi 页面证据边界

以下依据既有组件的实测记录，并非全站或持续实时保证：

- [身份与列表调查](https://github.com/imagebuilder1837/bangumi-second-degree-friends/blob/main/docs/external/bangumi.md)：数字主页可归一到 username，但数字关系子路由曾与规范 username 子路由返回不同内容；不能据数字字符串推断它一定是 UID。
- [已知异常样本](https://github.com/imagebuilder1837/bangumi-relationship-store/blob/a020477707b0f65d59796123bc5e22ebc4f99692/docs/external/bangumi.md)：有身份显示“[已注销]”而列表正常的反例，也有 HTTP 200 返回特定不可访问页的稳定错误；另有标准列表条目缺失用户标识的实测案例。
- 列表曾出现同一已识别用户重复条目。既有样本未证明原站永不分页或截断，亦未证明任意用户、隐私状态、会话状态均可读取。
