# Courier MVP

快递小哥派送系统 MVP，使用 Node.js + Express + SQLite 实现。项目提供快递小哥管理、包裹创建、包裹分配、待派送查询、状态更新、包裹列表查询、异常件登记和派送签收凭证接口。

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
│   ├── response.js         # 统一响应格式工具
│   └── validators.js       # 请求参数校验工具
├── routes/
│   ├── courier.js          # 快递小哥路由
│   ├── package.js          # 包裹路由
│   ├── exception.js        # 异常件登记路由
│   └── delivery_receipt.js # 派送签收凭证路由
├── services/
│   ├── exception.js        # 异常件业务逻辑
│   └── delivery_receipt.js # 签收凭证业务逻辑
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

签收方式：

| 值 | 说明 |
|---|---|
| PERSONAL_SIGN | 本人签收 |
| AGENT_SIGN | 代收人签收 |
| CODE_SIGN | 验证码签收 |
| SMART_CABINET | 智能快递柜签收 |

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

### 批量分配包裹给某个小哥

运营可以一次选择多个 `CREATED` 状态的包裹分配给同一个 `ON_DUTY` 快递小哥。每个包裹独立处理，不会因为其中一个失败而影响其他包裹的结果。

```bash
curl -X POST http://localhost:3000/api/packages/batch-assign \
  -H "Content-Type: application/json" \
  -d '{
    "package_ids": [1, 2, 3],
    "courier_id": 1
  }'
```

请求参数：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `package_ids` | `number[]` | 是 | 包裹ID列表，非空数组，最多100个，不可重复，每个ID为正整数 |
| `courier_id` | `number` | 是 | 快递小哥ID |

成功响应示例（部分包裹不存在时）：

```json
{
  "code": 0,
  "message": "批量分配完成: 2 成功, 1 失败",
  "data": {
    "courier_id": 1,
    "total": 3,
    "succeeded": 2,
    "failed": 1,
    "details": [
      {
        "package_id": 1,
        "success": true,
        "data": {
          "id": 1,
          "tracking_no": "SF20240601000001",
          "status": "ASSIGNED",
          "courier_id": 1,
          "..."
          : "..."
        }
      },
      {
        "package_id": 2,
        "success": true,
        "data": {
          "id": 2,
          "tracking_no": "SF20240601000002",
          "status": "ASSIGNED",
          "courier_id": 1,
          "..."
          : "..."
        }
      },
      {
        "package_id": 3,
        "success": false,
        "reason": "包裹不存在"
      }
    ]
  }
}
```

每个包裹可能的失败原因：

| reason | 说明 |
|---|---|
| `包裹不存在` | 指定ID的包裹在数据库中不存在 |
| `包裹当前状态为 xxx，只有 CREATED 状态的包裹可以分配` | 包裹状态不符合分配条件 |
| `包裹已被分配给其他快递小哥` | 包裹已有 courier_id |
| `分配失败: xxx` | 数据库操作异常等内部错误 |

请求校验失败时（快递小哥不存在、不在岗、参数格式错误等），整个请求直接返回错误，不进入逐个处理阶段。

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

`courier_id` 可用于校验该包裹是否分配给当前小哥。状态只能按状态流向前更新。**注意：不可通过此接口直接将状态变更为 `DELIVERED`，需通过签收凭证接口提交签收信息后自动变更。**

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

支持按运单号模糊搜索：

```bash
curl "http://localhost:3000/api/packages?tracking_no=SF2024"
```

支持按收件人手机号模糊搜索：

```bash
curl "http://localhost:3000/api/packages?receiver_phone=13900001111"
```

支持按收件地址关键词模糊搜索：

```bash
curl "http://localhost:3000/api/packages?receiver_address=海淀"
```

支持组合搜索与分页：

```bash
curl "http://localhost:3000/api/packages?status=DELIVERING&receiver_address=海淀&page=1&page_size=10"
```

查询参数：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `status` | `string` | 否 | 按包裹状态精确筛选 |
| `courier_id` | `number` | 否 | 按快递小哥ID精确筛选 |
| `tracking_no` | `string` | 否 | 按运单号模糊搜索 |
| `receiver_phone` | `string` | 否 | 按收件人手机号模糊搜索 |
| `receiver_address` | `string` | 否 | 按收件地址关键词模糊搜索 |
| `page` | `number` | 否 | 页码，默认1 |
| `page_size` | `number` | 否 | 每页数量，默认10，最大100 |

分页响应示例：

```json
{
  "code": 0,
  "message": "操作成功",
  "data": {
    "list": [
      {
        "id": 1,
        "tracking_no": "SF20240601000001",
        "receiver_name": "客户甲",
        "receiver_phone": "13900001111",
        "receiver_address": "北京市海淀区知春路1号",
        "status": "CREATED",
        "courier_id": null,
        "courier_name": null,
        "courier_phone": null,
        "created_at": "2026-06-05 17:01:57",
        "updated_at": "2026-06-05 17:01:57"
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 10,
      "total": 5,
      "total_pages": 1
    }
  }
}
```

### 查看包裹详情

```bash
curl http://localhost:3000/api/packages/1
```

若该包裹已签收，返回数据中会包含 `delivery_receipt` 字段，记录签收人姓名、签收方式和签收时间等信息。

### 查询全部快递小哥

```bash
curl http://localhost:3000/api/couriers
```

### 提交签收凭证

包裹从 `DELIVERING` 变为 `DELIVERED` 必须通过此接口提交签收凭证，不可直接变更包裹状态：

```bash
curl -X POST http://localhost:3000/api/delivery-receipts \
  -H "Content-Type: application/json" \
  -d '{
    "package_id": 4,
    "courier_id": 1,
    "signer_name": "客户甲",
    "sign_method": "PERSONAL_SIGN",
    "sign_time": "2026-06-05 14:30:00"
  }'
```

必填字段：`package_id`、`courier_id`、`signer_name`、`sign_method`、`sign_time`

`sign_method` 可选值：`PERSONAL_SIGN`（本人签收）、`AGENT_SIGN`（代收人签收）、`CODE_SIGN`（验证码签收）、`SMART_CABINET`（智能快递柜签收）

校验逻辑：
- 包裹必须处于 `DELIVERING` 状态
- 提交人必须是该包裹的负责快递小哥
- 同一包裹不可重复提交签收凭证
- 提交成功后包裹状态自动变更为 `DELIVERED`

### 查询签收凭证列表

```bash
curl http://localhost:3000/api/delivery-receipts
```

支持按快递小哥筛选：

```bash
curl "http://localhost:3000/api/delivery-receipts?courier_id=1"
```

支持按包裹筛选：

```bash
curl "http://localhost:3000/api/delivery-receipts?package_id=4"
```

支持组合筛选：

```bash
curl "http://localhost:3000/api/delivery-receipts?courier_id=1&package_id=4"
```

### 查看签收凭证详情

```bash
curl http://localhost:3000/api/delivery-receipts/1
```

返回签收凭证详情，包含关联的包裹和快递小哥信息。

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
