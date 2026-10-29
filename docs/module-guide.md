# 模块导航

| 文件                                | 职责                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `src/main.mjs`、`src/entry.mjs`     | 极薄启动、页面范围及重复挂载保护、浏览器依赖组装                       |
| `src/site.mjs`                      | 输入与主页身份归一、单响应关系列表及资料解析                           |
| `src/requests.mjs`                  | 共享请求队列、取消与超时、重试、全局限流                               |
| `src/errors.mjs`                    | 跨模块的稳定错误原因，原始消息与原因保留                               |
| `src/data.mjs`                      | 网络观察获取与提交、缓存成本估算、共享库适配、扫描资料                 |
| `src/graph.mjs`                     | 独立关系观察仲裁、有效邻接关系、无效节点                               |
| `src/search.mjs`                    | 双向整层搜索、最短性边界、受影响依赖的局部重证                         |
| `src/session.mjs`                   | 端点初始化与异步竞态、随机填入、运行／停止及同页会话                   |
| `src/exclusions.mjs`                | 排除中转名单、身份核验与取消、独立偏好持久化及共享展示资料             |
| `src/random-users.mjs`              | 随机候选校验、抽样范围探测及独立范围记忆                               |
| `src/view.mjs`、`src/styles.mjs`    | 弹窗及入口、路径呈现、原站风格和响应式样式                             |
| `src/mode-picker.mjs`               | 关系模式选择器的候选、确认、焦点及浮层定位                             |
| `src/path-layout.mjs`               | 保持用户序列的自适应蛇形排布与关系连线                                 |
| `vendor/bangumi-relationship-store` | 独立 submodule，提供共享关系数据库协议                                 |
| `scripts/`                          | 发布校验、可审计构建、综合检查                                         |
| `test/`                             | 已约定边界上的行为测试；支持代码及 HTML 样本分别放在 support、fixtures |
