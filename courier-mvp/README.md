# Courier MVP

快递小哥派送系统 MVP，使用 Node.js + Express + SQLite 实现。项目提供快递小哥管理、包裹创建、包裹分配、待派送查询、状态更新、包裹列表查询和异常件登记接口。

## 启动

```bash
npm install
npm start
```

服务默认启动在：

```text
http://localhost:3000
```

接口索引：

```bash
curl http://localhost:3000/
```

## 项目结构

```text
courier-mvp/
├── app.js                  # 入口文件，挂载路由与启动服务
├── db.js                   # 数据库初始化、连接与 helper 函数
├── utils/
│   └── response.js         # 统一响应格式工具
├── routes/
│   ├── courier.js          # 快递小哥路由
│   ├── package.js          # 包裹路由
│   └── exception.js        # 异常件登记路由
├── services/
│   └── exception.js        # 异常件业务逻辑
├── data/
│   └── courier.db          # SQLite 数据库文件（自动生成）
└── package.json
```

## 初始化数据

应用启动时会自动创建 SQLite 数据库文件：

```text
data/courier.db
```

如果数据库中还没有快递小哥数据，启动时会自动写入种子数据：

- 快递小哥：张三、李四、王五
- 包裹：5 条示例包裹，覆盖 CREATED、ASSIGNED、DELIVERING、DELIVERED 等状态

如果数据库已经有数据，启动时会跳过种子数据初始化。

包裹状态流：

```text
CREATED -> ASSIGNED -> PICKED_UP -> DELIVERING -> DELIVERED / FAILED
```

快递小哥状态：

```text
ON_DUTY, OFF_DUTY
```

异常件状态流：

```text
PENDING -> PROCESSING -> RESOLVED / CLOSED
```

异常类型：

| 值 | 说明 |
|---|---|
| REFUSED | 收件人拒收 |
| NOT_HOME | 收件人不在家 |
| ADDRESS_WRONG | 地址错误 |
| DAMAGED | 包裹破损 |
| CONTACT_FAILED | 联系不上收件人 |
| OTHER | 其他 |

## 主要接口示例

下面示例假设服务已经在 `http://localhost:3000` 启动。

### 新增快递小哥

```bash
curl -X POST http://localhost:3000/api/couriers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "赵六",
    "phone": "13800006666",
    "status": "ON_DUTY"
  }'
```

### 新增包裹

```bash
curl -X POST http://localhost:3000/api/packages \
  -H "Content-Type: application/json" \
  -d '{
    "tracking_no": "SF20260605000001",
    "sender_name": "发件人F",
    "sender_phone": "13700006666",
    "receiver_name": "客户丁",
    "receiver_phone": "13900004444",
    "receiver_address": "北京市西城区金融街8号",
    "weight": 2.5
  }'
```

`tracking_no` 可不传，服务会自动生成运单号。

### 把包裹分配给某个小哥

```bash
curl -X PUT http://localhost:3000/api/packages/1/assign \
  -H "Content-Type: application/json" \
  -d '{
    "courier_id": 1
  }'
```

只有 `CREATED` 状态的包裹可以分配给 `ON_DUTY` 状态的快递小哥。

### 查询某个小哥的待派送包裹

```bash
curl http://localhost:3000/api/couriers/1/packages
```

返回该快递小哥名下未完成的包裹，不包含 `DELIVERED` 和 `FAILED` 状态。

### 小哥更新包裹状态

```bash
curl -X PUT http://localhost:3000/api/packages/1/status \
  -H "Content-Type: application/json" \
  -d '{
    "courier_id": 1,
    "status": "PICKED_UP"
  }'
```

`courier_id` 可用于校验该包裹是否分配给当前小哥。状态只能按状态流向前更新。

### 查看全部包裹列表

```bash
curl http://localhost:3000/api/packages
```

支持按状态过滤：

```bash
curl "http://localhost:3000/api/packages?status=ASSIGNED"
```

支持按快递小哥过滤：

```bash
curl "http://localhost:3000/api/packages?courier_id=1"
```

### 查看包裹详情

```bash
curl http://localhost:3000/api/packages/1
```

### 查询全部快递小哥

```bash
curl http://localhost:3000/api/couriers
```

### 登记异常件

快递小哥派送失败时，登记异常件记录：

```bash
curl -X POST http://localhost:3000/api/exceptions \
  -H "Content-Type: application/json" \
  -d '{
    "package_id": 4,
    "courier_id": 1,
    "exception_type": "NOT_HOME",
    "description": "收件人不在家，已联系但无法确认返回时间",
    "on_site_remark": "门口有快递柜，已放置并拍照"
  }'
```

必填字段：`package_id`、`courier_id`、`exception_type`

`exception_type` 可选值：`REFUSED`（收件人拒收）、`NOT_HOME`（收件人不在家）、`ADDRESS_WRONG`（地址错误）、`DAMAGED`（包裹破损）、`CONTACT_FAILED`（联系不上收件人）、`OTHER`（其他）

`description` 为异常说明，`on_site_remark` 为现场备注，均为选填。

登记异常件后，若包裹当前状态为 `DELIVERING`，将自动变更为 `FAILED`。

### 查询异常件列表

```bash
curl http://localhost:3000/api/exceptions
```

支持按状态筛选：

```bash
curl "http://localhost:3000/api/exceptions?status=PENDING"
```

支持按快递小哥筛选：

```bash
curl "http://localhost:3000/api/exceptions?courier_id=1"
```

支持按包裹筛选：

```bash
curl "http://localhost:3000/api/exceptions?package_id=4"
```

支持组合筛选：

```bash
curl "http://localhost:3000/api/exceptions?status=PENDING&courier_id=1"
```

### 查看异常件详情

```bash
curl http://localhost:3000/api/exceptions/1
```

返回异常记录详情，包含关联的包裹和快递小哥信息。

### 更新异常件状态（后台处理）

```bash
curl -X PUT http://localhost:3000/api/exceptions/1/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "PROCESSING"
  }'
```

异常状态只能按状态流向前更新：

```text
PENDING → PROCESSING → RESOLVED
PENDING → CLOSED
PROCESSING → CLOSED
```

`RESOLVED` 和 `CLOSED` 为终态，不可再变更。

## 返回格式

接口统一返回 JSON：

```json
{
  "code": 0,
  "message": "操作成功",
  "data": {}
}
```

错误时 `code` 为 `-1`，`message` 会说明失败原因。
