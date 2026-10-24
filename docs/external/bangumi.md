# Bangumi 原站调查

## 证据与来源

本文件保存与本组件有关的调查事实，不依赖远程调查文档。原站路径均相对于表中域名，来源名称和路径为追溯标识，不是运行依赖。

| 来源                                                                                                                            | 证据范围                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bangumi-second-degree-friends` 的 `docs/external/bangumi.md`，版本 `40c7d1c47535ef54dbe6688a4d8257430eba2ac0`，2026-10-24 整理 | 匿名 HTTP 工具取得的 HTML、CSS、JavaScript；原站资源版本 `r771`。未运行浏览器脚本，所述结构是响应正文，不是视觉验收。工具未展示状态码、响应头、最终 URL 或重定向链。                            |
| `bangumi-relationship-store` 的 `docs/external/bangumi.md`，版本 `a020477707b0f65d59796123bc5e22ebc4f99692`                     | 登录态浏览器异常样本、反例及响应重放记录；不是此次重新抓取。                                                                                                                                    |
| 站方指南与实际分发资源                                                                                                          | `bgm.tv` 的 `/dev`、`/dev/garage`、`/group/topic/345157`、`/group/topic/345291`、`/index/81881`、`/min/g=js?r771`、`/css/dist/bangumi.min.css?r771`。历史指南不保证当前后台表单或审核流程一致。 |
| Bangumi 官方 API schema                                                                                                         | `bangumi/api` 的 `open-api/v0.yaml`；网页路由不能直接套用 API 路由限制。                                                                                                                        |

以下区分实测、官方说明／源码、标准及推断。样本不保证全站、其他隐私或会话状态、未来页面一致；未验证不等于不存在。数字主页的补充实测见 [随机抽取证据](bangumi-random-users.md)，本地存储标准见 [浏览器存储](browser-storage.md)。

## 组件加载与作用域

- **官方说明**：组件是站内 JavaScript／CSS 增强。2018 年指南描述在 `/dev/app` 新建组件应用、添加 JavaScript／CSS 版本，在 `/settings/gadgets` 启用，并可提交审核；未登录核验当前编辑和审核流程，不能沿用最初内测“仅创建者可用”的限制。
- **官方说明**：支持 metadata 的 `@include`、`@exclude`、`@match`，exclude 优先；可用 `log.setLevel('debug')` 查看解析信息，不代表实现所有 userscript 指令。
- **分发源码实测**：`chiiLib.widget.loader` 逐个启动脚本／样式加载，未见串行等待全部脚本。脚本经 `$.ajax` 文本读取、`userscriptParser` 解析 metadata、按当前地址及暂停状态检查作用域，再包装进 `(function(CHII_APP_ID){ ... })(...)`、注入 `chiiApp.cloud_settings` 并 `eval`；样式另建 `link` 插入首个 script 前。
- **分发源码实测**：未见 `run-at` 调度或 GM 特权接口实现。不能依赖 `@run-at document-end` 或 `@grant none` 作为原站加载时序／沙箱保证。有匹配数组时 include 或 match 命中且 exclude 不命中才执行；无匹配数组时允许执行。
- **源码解释**：`/user/*` 的通配符不限一个路径段，单靠 metadata 不能排除 `/user/sai/friends` 等子页。主页样本为 `/user/sai`、`/user/1`；尾斜杠与查询参数组合未作浏览器实测。

## 主页入口与主题

来源：`bgm.tv` 与 `bangumi.tv` 的 `/user/sai`，以及 `r771` 样式表。

- **HTML 实测**：`#user_home .user_box ul.network_service.clearit` 是 `ul`，直接子项是 `li`。药丸为 `span.service`；链接位于后续 `span.tip > a.l`，药丸本身不是链接。服务项可有内联背景色。仅证明所测主页有此容器，不能保证所有主页都有。
- **CSS 实测**：`.network_service` margin 为 `5px 0`；子 `li` 左浮动、margin `5px`；`span.service` 为 11px、padding `2px 10px`、背景 `#eee`、白字、圆角 `100px`，未见紧邻的独立深色覆盖。
- **主题实测**：根节点为 `data-theme="light" data-theme-color="pink"`；深色规则依据 `html[data-theme=dark]`，不是只依据系统媒体查询。

| 原站样式         | 浅色                                                                                   | 深色／其他                                       |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `.tip`           | `#666`                                                                                 | `#d8d8d8`                                        |
| `a.l`            | `#0084b4`                                                                              | `#2ea6ff`；hover `#02a3fb`                       |
| `.user_box` 文字 | `#333`                                                                                 | `#e9e9e9`                                        |
| `a.chiiBtn`      | inline-block、12px、行高 20px、padding `2px 12px`、圆角 20px、文字 `#666`、边框 `#ddd` | 文字 `#d8d8d8`、边框 `#6e6e6e`，并替换渐变与阴影 |

`a.chiiBtn` 仅有样式存在的证据，匿名 Sai 主页未出现，不能当作 network_service 的现有结构。未做主题切换、computed style、移动布局或截图验收。

## 关系方向、列表与单页输出

- **原站文字实测**：`/user/sai` 的 `#friend` 标题为“Sai🖖的朋友”，more 指向 `/user/sai/friends`；“+ 谁加Sai🖖为好友”指向 `/user/sai/rev_friends`。据此 friends 是出向好友关系，rev_friends 是入向好友关系，不要求互相添加。未通过增删好友验证。
- **共用结构实测**：`bgm.tv` 的 `/user/sai/friends`、`/user/sai/rev_friends`、`/user/2/friends` 均为以下结构。

| 信息             | 响应正文中的结构                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| 列表             | `#columnUserSingle` 下的 `ul#memberUserList.usersMedium`                                                        |
| 条目             | `#memberUserList > li.user`，部分带 `odd` 类                                                                    |
| 用户链接／显示名 | `.userContainer > strong > a.avatar`，href 为 `/user/{路径身份}`；文字可含空白、emoji、省略号，不能用作唯一身份 |
| 头像             | `.userImage > span.avatarNeue` 的内联 `background-image`，不是 `img`                                            |

**已观察样本是单次输出列表，没有分页证据：**

- 三份完整响应均未找到 `page`、`?page=`、`page_inner`、`paginator` 或 `multipage`。列表 `</li></ul>` 后结束主体并进入 footer；Sai 的反向好友页约 86.9 万字符，仍无分页控件。
- 额外读取一次 `/user/sai/friends?page=2`，与无参数样本同为 133877 字符；核对的开头和用户条目片段相同，没有第二页前进的证据；未做全量字节比较。
- 不能据这些样本设计固定每页条数、下一页选择器或末页页码；任意添加 `page=N` 后仍有条目不代表存在下一页，缺少列表也不是末页。
- “全站永不分页／永不截断”未验证。这一限制不是原站存在分页的证据。

## 身份与路径归一

- **列表实测**：同一列表混有 `/user/2`、`/user/237`、`/user/e6nian`、`/user/asher`；`asher` 显示名为“白菜”。显示名不等于用户标识，纯数字用户标识不等于已经证明是数字用户 ID。
- **官方 schema**：User 分别定义 integer `id`、string `username`、string `nickname`；username 注释为“唯一用户名，初始与 UID 相同，可修改一次”。API 的 `path_username` 说明设置 username 后不能使用 UID；这是 API 契约，不是网页路由保证。
- **主页实测**：`/user/1`、`/user/sai` 均以 `#headerProfile h1.nameSingle .inner > .name > a[href]` 提供 `/user/sai`；同级 `small.grey` 为 `@sai`。两份正文未找到 canonical。`CHOBITS_UID`、`CHOBITS_USERNAME` 表示当前访问者，不能当作主页用户身份。
- **关系链接实测**：两份主页均提供规范 `/user/sai/friends` 和 `/user/sai/rev_friends`；前者位于 `#headerProfile .navTabs a[href$="/friends"]`，后者位于 `#friend a[href$="/rev_friends"]`。消费主页给出的规范身份可避免猜测数字关系子路由。
- **数字子路由反例**：`/user/1/rev_friends` 返回 133877 字符，所看片段与 Sai 的 friends 一致；`/user/sai/rev_friends` 返回 869210 字符且早期条目不同。不能推定数字 ID 与自定义用户标识的关系子路由等价。工具未展示重定向链，不能断言服务器重定向或路由机制。
- **推断与限制**：原始 href、显示名、头像文件名均不足以证明跨响应的永久稳定身份；未找到数字 ID 长期不可变的官方网页契约，也未证明所有列表始终使用当前规范身份。

## 匿名访问、空列表与原站异常

- **匿名正文实测**：上述主页和两类列表有 `CHOBITS_UID = 0`、`CHOBITS_USERNAME = ''` 及登录／注册链接，仍返回用户条目。原站 JS 的 `initSortBy` 仅在 UID 大于零时提供“自己”过滤，`updateFilterBy('self')` 按 CHOBITS_USERNAME 匹配回复作者，支持这些变量表示访问者。未在该次调查验证真实登录态变量赋值。
- **空好友页实测**：`/user/8/friends`（堂堂）、`/user/237/friends`（水银控）均有匹配身份头和明确空的 `<ul id="memberUserList" class="usersMedium"></ul>`，无额外“暂无好友”文本；两人的反向好友页有实际条目。这不等于验证了空反向好友模板；缺少列表不能解释为零关系。
- **不存在用户正文实测**：`/user/__external_research_nonexistent__/friends` 无列表，主体为原站拼写的 `#colunmNotice`：`h2`“呜咕，出错了”、`p.text`“数据库中没有查询到该用户的信息”、图片 `/img/bangumi/404.png`。该次 HTTP 状态未知，图片名称不能证明 404。
- **重复条目实测**：`/user/775750/rev_friends` 返回 254 条，其中 `/user/soranomethod`（昵称“神户小德”）重复两次，按用户标识去重为 253 位；不能按昵称去重。

### 登录态异常与反例

- `shironegi` 的好友中，`616197`、`1041797`、`1208024`、`1097234`、`1189298`、`1260050` 的主页身份匹配、显示名为 `[已注销]`；friends 返回 HTTP 200、最终地址不变，且只有 `#colunmNotice` 错误主体，无身份头或列表。错误文字为 `h2`“呜咕，出错了”、`p.text`“啊噢，你访问的页面似乎被 Bangumi 娘吃掉了。”，图片 `/img/bangumi/404.png`。禁用缓存重取仍如此；`616197/rev_friends` 也如此。
- **反例**：同名 `[已注销]` 的 `yuri_chan` 的 friends 是合法空列表，rev_friends 有 167 条；`aguamalas`、`763761`、`e911` 的 friends 也可正常解析。昵称不足以判断列表不可访问。
- **缓存响应重放实测**：`venusxx/friends` 为 HTTP 200、570 个标准条目，其中一项链接 `/user/`、昵称为空、头像背景指向 `lain.bgm.tv` 的 `/pic/user/l/`。只移除此项后其余 569 位均通过身份及列表校验；无法恢复该条目的用户标识或判断真实账号状态。

这些异常不能证明零关系、真实注销或封禁状态。权限拒绝、会话过期及各 HTTP 错误与正文的普遍对应关系未验证。

## 三域名、凭据与头像

- **实测**：`bgm.tv`、`bangumi.tv` 的 `/user/sai` 均返回主页 HTML 和相同 network_service 片段，各自 SITE_URL 为当前域的 HTTPS 地址。原调查缺少重定向头，不保证所有路径不跨主机跳转。
- **抓取障碍实测**：`chii.in/user/sai` 返回 `Just a moment...`、`Enable JavaScript and cookies to continue` 及 `/cdn-cgi/challenge-platform/` 验证正文，未取得用户 DOM。这不是 429 的证据，也不证明正常浏览器不能访问。
- **Fetch 标准**：credentials 默认为 `same-origin`，只对同源请求带凭据；redirect 默认为 `follow`。三个主机不同源；`include` 不保证另一域已有登录态，也不绕过 CORS。cookie Domain／SameSite／Secure、跨域会话同步、HTML fetch 的 CORS 和跨域跳转可读性未验证。
- **头像实测**：用户链接多为根相对路径；头像为协议相对 CDN `lain.bgm.tv` 路径。`/user/2` 使用 `/pic/user/l/000/00/00/2.jpg?r=1322480632`；`/user/8`、`/user/237` 使用 `/pic/user/l/icon.jpg`；`mizudiwood` 使用 `/pic/user/l/000/02/18/21804_2Oro7.jpg?r=1757342413&hd=1`。HTTPS 页面基准解析后头像也是 HTTPS，但 CDN 不同源。
- **推断**：数字路径不足以构造当前头像地址，因为存在默认图、自定义后缀和版本参数。官方 API schema 提供 `avatar.large/medium/small` 和 `/v0/users/{username}/avatar` 重定向接口，但它仍需另发请求，本次未验证浏览器使用。

## 限流与 HTTP

- **原站未确认**：未找到适用于网页 friends／rev_friends 的公开频率、并发额度、窗口、封禁时长、429 正文或 Retry-After 保证；未主动触发限流。API 限流不能直接套用到网页，Cloudflare 验证不能当作限流。
- **RFC 6585 §4、§7.2**：429 表示请求过多，响应可以但不必须含 Retry-After；服务器也可以丢弃连接等，不必使用 429。
- **RFC 9110 §10.2.3、§5.6.7**：Retry-After 为 HTTP-date 或非负十进制秒数。发送方必须使用 IMF-fixdate；解析 HTTP-date 的接收方必须接受 IMF-fixdate、旧 RFC 850 和 asctime 三种格式，例如 `Sun, 06 Nov 1994 08:49:37 GMT`、`Sunday, 06-Nov-94 08:49:37 GMT`、`Sun Nov  6 08:49:37 1994`，均按 UTC 解释。这是标准，不是 Bangumi 返回该头或采用某限额的实测证据。
