# 开发

使用支持 Node 内置测试器的 Node.js 和 npm。

```sh
git submodule update --init --recursive
npm ci
npm run build
npm run check
```

单文件行为测试：`node --test test/search.test.mjs`；全部测试：`npm test`。
HTML 样本为保留已调查选择器的合成样本，不是真实登录态或原站全量抓取。

`npm run check` 检查格式、语法、发布元数据及锁文件一致性、产物可复现性，最后执行全部测试。
修改源码后重新构建；不要直接编辑 `src/index.user.js`。
