# 站点和区域分拣模块 - 接口文档

## 数据结构设计

### 1. 站点 (site)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| name | TEXT | 站点名称，唯一 |
| address | TEXT | 站点地址 |
| phone | TEXT | 站点联系电话 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 2. 配送区域 (delivery_zone)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| site_id | INTEGER | 所属站点ID，外键 |
| name | TEXT | 区域名称，同一站点下唯一 |
| description | TEXT | 区域描述 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3. 小哥负责区域 (courier_zone)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| courier_id | INTEGER | 快递小哥ID，外键 |
| zone_id | INTEGER | 配送区域ID，外键 |
| created_at | TEXT | 创建时间 |

**唯一约束**: (courier_id, zone_id) 组合唯一

### 4. 包裹表扩展 (package)
新增字段：
| 字段 | 类型 | 说明 |
|------|------|------|
| site_id | INTEGER | 所属站点ID，外键，可为NULL（兼容历史数据） |
| zone_id | INTEGER | 配送区域ID，外键，可为NULL（兼容历史数据） |

---

## 站点管理接口

### 1. 创建站点
**POST** `/api/sites`

请求体：
```json
{
  "name": "中关村站点",
  "address": "北京市海淀区中关村大街1号",
  "phone": "010-88888801"
}
```

响应：
```json
{
  "code": 0,
  "message": "站点创建成功",
  "data": {
    "id": 1,
    "name": "中关村站点",
    "address": "北京市海淀区中关村大街1号",
    "phone": "010-88888801",
    "created_at": "2024-06-06 10:00:00",
    "updated_at": "2024-06-06 10:00:00"
  }
}
```

### 2. 查询站点列表
**GET** `/api/sites`

响应：
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "name": "中关村站点",
      "address": "北京市海淀区中关村大街1号",
      "phone": "010-88888801",
      "created_at": "2024-06-06 10:00:00",
      "updated_at": "2024-06-06 10:00:00"
    }
  ]
}
```

### 3. 查询站点详情
**GET** `/api/sites/:id`

响应：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "name": "中关村站点",
    "address": "北京市海淀区中关村大街1号",
    "phone": "010-88888801",
    "created_at": "2024-06-06 10:00:00",
    "updated_at": "2024-06-06 10:00:00"
  }
}
```

### 4. 更新站点
**PUT** `/api/sites/:id`

请求体：
```json
{
  "name": "中关村站点（新）",
  "address": "新地址",
  "phone": "新电话"
}
```

### 5. 删除站点
**DELETE** `/api/sites/:id`

**注意**：站点下有配送区域或包裹时无法删除。

---

## 配送区域管理接口

### 1. 创建配送区域
**POST** `/api/zones`

请求体：
```json
{
  "site_id": 1,
  "name": "海淀区-知春路片区",
  "description": "知春路、五道口周边区域"
}
```

### 2. 查询配送区域列表
**GET** `/api/zones?site_id=1`

查询参数：
- `site_id` (可选): 按站点筛选

响应：
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "site_id": 1,
      "name": "海淀区-知春路片区",
      "description": "知春路、五道口周边区域",
      "site_name": "中关村站点",
      "created_at": "2024-06-06 10:00:00",
      "updated_at": "2024-06-06 10:00:00"
    }
  ]
}
```

### 3. 查询配送区域详情
**GET** `/api/zones/:id`

### 4. 更新配送区域
**PUT** `/api/zones/:id`

请求体：
```json
{
  "name": "新区域名称",
  "description": "新描述"
}
```

### 5. 删除配送区域
**DELETE** `/api/zones/:id`

**注意**：区域下有负责的快递小哥或包裹时无法删除。

### 6. 查询区域可分配的在岗快递小哥
**GET** `/api/zones/:id/available-couriers`

响应：
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "name": "张三",
      "phone": "13800001111",
      "status": "ON_DUTY",
      "created_at": "2024-06-06 10:00:00",
      "updated_at": "2024-06-06 10:00:00"
    }
  ]
}
```

---

## 小哥负责区域管理接口

### 1. 为快递小哥分配负责区域
**POST** `/api/courier-zones`

请求体：
```json
{
  "courier_id": 1,
  "zone_id": 1
}
```

### 2. 移除快递小哥的负责区域
**DELETE** `/api/courier-zones`

请求体：
```json
{
  "courier_id": 1,
  "zone_id": 1
}
```

### 3. 查询快递小哥负责的所有区域
**GET** `/api/couriers/:id/zones`

响应：
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": 1,
      "site_id": 1,
      "name": "海淀区-知春路片区",
      "description": "知春路、五道口周边区域",
      "site_name": "中关村站点"
    }
  ]
}
```

### 4. 查询负责该区域的所有快递小哥
**GET** `/api/zones/:id/couriers`

---

## 包裹相关接口（扩展）

### 1. 创建包裹（支持绑定站点和区域）
**POST** `/api/packages`

请求体：
```json
{
  "tracking_no": "SF20240606000001",
  "sender_name": "发件人A",
  "sender_phone": "13700001111",
  "receiver_name": "客户甲",
  "receiver_phone": "13900001111",
  "receiver_address": "北京市海淀区知春路1号",
  "weight": 1.5,
  "site_id": 1,
  "zone_id": 1
}
```

**校验规则**：
- `site_id` 和 `zone_id` 均为可选
- 如果指定了 `zone_id`，会校验区域是否存在
- 如果同时指定了 `site_id` 和 `zone_id`，会校验该区域是否属于所选站点

### 2. 查询包裹列表（支持按站点和区域筛选）
**GET** `/api/packages?site_id=1&zone_id=1`

新增查询参数：
- `site_id`: 按站点筛选
- `zone_id`: 按配送区域筛选

响应中每个包裹包含：
- `site_name`: 站点名称
- `zone_name`: 区域名称

### 3. 包裹分配（区域校验）
**PUT** `/api/packages/:id/assign`

**校验规则**：
- 如果包裹绑定了配送区域，只能分配给负责该区域且在岗的快递小哥
- 没有绑定区域的包裹，可以分配给任何在岗的快递小哥（兼容历史数据）

### 4. 批量分配包裹
**POST** `/api/packages/batch-assign`

**校验规则**：同单个分配，每个包裹独立校验并返回结果

---

## 初始化种子数据

系统首次启动时会自动初始化以下数据：

### 站点
1. 中关村站点 - 北京市海淀区中关村大街1号
2. 望京站点 - 北京市朝阳区望京SOHO

### 配送区域
1. 海淀区-知春路片区（中关村站点）- 知春路、五道口周边区域
2. 海淀区-中关村片区（中关村站点）- 中关村、苏州街周边区域
3. 朝阳区-望京片区（望京站点）- 望京、酒仙桥周边区域
4. 朝阳区-国贸片区（望京站点）- 国贸、CBD周边区域

### 小哥负责区域
- 张三：海淀区-知春路片区、海淀区-中关村片区
- 李四：朝阳区-望京片区、朝阳区-国贸片区
- 王五：海淀区-知春路片区

### 包裹
5个示例包裹，部分绑定了站点和区域，部分已分配给快递小哥

---

## 兼容性说明

1. **历史数据兼容**：`site_id` 和 `zone_id` 字段允许为 NULL，现有没有站点字段的历史包裹可以正常使用
2. **分配规则兼容**：没有绑定区域的包裹，分配时不做区域校验，可以分配给任何在岗的快递小哥
3. **数据库自动迁移**：系统启动时会自动检查并添加新字段，无需手动操作
