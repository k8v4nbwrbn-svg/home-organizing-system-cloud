# 家政收纳会员报价与客户跟进系统

这是一个可本地运行的 MVP，包含：

- 微信小程序：扫码进入、微信授权登录、房屋面积/户型、收纳需求多选、实时预算、提交线索。
- 客户端客服页：展示后台启用的多个客服微信二维码，支持长按识别和查看大图。
- 手机号绑定：客户先完成微信登录，再在登录页底部、“退出微信登录”上方手动绑定手机号。
- 小程序分享：客户可以直接把小程序分享给微信好友。
- 管理后台：实时新线索、客户资料、预算快照、跟进状态、备注和下次跟进时间。
- 客户线索支持软删除，删除后进入回收箱，可按姓名、手机号或地址搜索并恢复。
- 客户详情支持解绑微信或解除微信手机号授权；解绑微信会让旧会员令牌立即失效，但保留客户资料和历史订单。
- 收费客户：客户详情可登记定金或全款，后台按收费类型归拢客户；退费后对应收款自动移出收费分组。
- 客户订单：微信登录后可查看历史需求、参考报价和当前跟进状态。
- 我的优惠券：客户可查看当前微信名下所有优惠券，并区分可用、已使用、已过期和已停用状态。
- 优惠券：后台创建固定金额或折扣券，可按姓名/手机号搜索客户后指定发放，也可一键发放给所有已微信登录会员，并在报价和下单时自动抵扣。
- 报价设置：面积单价、最低价、服务项目价格、预约时段系数。
- 微信小程序码生成：配置微信凭据后可生成正式小程序码。

## 环境要求

- macOS / Windows / Linux
- Node.js 22.5 或更高版本
- 微信开发者工具（上传小程序时使用）

当前项目使用 Node 内置 SQLite，不需要安装数据库。

## 启动后台

```bash
cd outputs/home-organizing-system
cp .env.example .env
```

编辑 `.env`：

```dotenv
PORT=8787
ADMIN_PASSWORD=换成你自己的密码
SESSION_SECRET=生成一段较长的随机字符串
WECHAT_APPID=
WECHAT_SECRET=
WECHAT_ENV_VERSION=release
```

也可以不手动编辑，直接双击项目根目录的 `配置微信凭据.command`。工具会隐藏输入 AppSecret，先向微信验证凭据，验证成功后才会写入配置并自动重启后台。

启动：

```bash
npm start
```

打开：

```text
http://127.0.0.1:8787/admin/
```

未设置 `.env` 时，演示密码是 `admin123`。正式使用前必须修改。

## 导入微信小程序

1. 打开微信开发者工具，导入 `miniprogram` 目录。
2. 在 `project.config.json` 中填入你的小程序 AppID，或直接在开发者工具中设置。
3. 打开 `miniprogram/config.js`，把 `apiBase` 改成后台的 HTTPS 地址。
4. 在微信公众平台把该 HTTPS 域名加入“request 合法域名”。
5. 将小程序 AppID/AppSecret 写入 `.env`，否则“微信登录”会明确提示尚未配置。

本地开发时可在微信开发者工具中临时关闭域名校验；手机真机和生产环境必须使用 HTTPS。

## 生成小程序码

在微信公众平台获取 AppID 和 AppSecret，写入 `.env` 后运行：

```bash
npm run generate:qr
```

生成的文件位于：

```text
public/qr/miniprogram.png
```

后台“小程序码”页面会自动显示。二维码路径带 `src=qr` 场景值，客户提交后会记录在后台的“扫码来源”里。

注意：没有微信 AppID、AppSecret 和已发布的小程序页面时，无法生成可打开小程序的正式二维码。

## 报价计算

默认计算方式：

```text
基础费 = max(面积 × 每平方米价格, 最低服务价)
服务费 = 所选服务项目价格之和
参考价 = (基础费 + 服务费) × 预约时段系数
预算区间 = 参考价上下浮动 10%
```

后台修改报价规则后，新提交的线索按新规则计算；每条线索会保存当时的报价快照，不会被后续改价影响。

## 数据与备份

数据库文件：

```text
data/app.sqlite
```

直接复制该文件即可做冷备份。建议每天备份一次 `data` 目录。

## 生产部署要点

1. 使用 Nginx/Caddy 反向代理到 `127.0.0.1:8787`，配置 HTTPS。
2. 把 `PUBLIC` 和 API 都放到同一个 HTTPS 域名下。
3. 修改 `ADMIN_PASSWORD` 和 `SESSION_SECRET`，不要继续使用演示密码。
4. 定期备份 `data/app.sqlite`。
5. 在微信公众平台完成小程序类目、隐私协议、用户信息收集说明和服务器域名配置。
6. 会员登录已接入 `wx.login` + 后端 `jscode2session`，服务端用 OpenID 关联客户档案并签发会员令牌。`SESSION_SECRET` 必须固定保存，修改后已有会员令牌会失效。

## 主要接口

```text
GET  /api/public/pricing          获取小程序可选服务和时段
POST /api/public/wechat-login     微信登录并获取会员令牌
POST /api/public/quote            计算预算
POST /api/public/leads            提交会员和需求
GET  /api/public/leads/:id/status 查询报价状态
GET  /api/public/me/leads         查询当前微信会员的订单
GET  /api/public/coupons          查询当前会员的优惠券
GET  /api/public/support-agents   查询客服微信二维码
POST /api/public/wechat-phone     授权获取并绑定微信手机号
POST /api/public/member/phone     手动绑定会员手机号

POST /api/admin/login             后台登录
GET  /api/admin/overview          工作台统计
GET  /api/admin/members           搜索会员（姓名或手机号）
GET  /api/admin/leads             客户线索列表
GET  /api/admin/leads/:id         线索详情和跟进记录
PATCH /api/admin/leads/:id        更新状态、备注和跟进时间
GET  /api/admin/payments          查询收费与定金客户
POST /api/admin/leads/:id/payments 登记定金或全款
POST /api/admin/payments/:id/refund 对单笔收款登记退费
POST /api/admin/members/:id/unbind 解绑微信或手机号授权（scope=wechat|phone）
DELETE /api/admin/leads/:id       将客户线索移入回收箱
POST /api/admin/leads/:id/restore 从回收箱恢复客户线索
GET  /api/admin/pricing           读取报价规则
PUT  /api/admin/pricing           保存报价规则
GET  /api/admin/coupons           获取优惠券活动
POST /api/admin/coupons           创建优惠券活动
PATCH /api/admin/coupons/:id      启用或停用优惠券
POST /api/admin/coupons/:id/issue 按手机号定向发放
POST /api/admin/coupons/:id/issue-all 向全体微信会员发放
GET  /api/admin/support-agents    获取客服列表
POST /api/admin/support-agents    新增客服和上传二维码
PATCH /api/admin/support-agents/:id 修改客服资料或更换二维码
GET  /api/admin/events            实时事件流（SSE）
```
