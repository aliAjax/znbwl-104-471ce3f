const { Router } = require('express');
const { success, fail } = require('../utils/response');
const {
  createSite,
  updateSite,
  deleteSite,
  getSiteById,
  getAllSites,
  createZone,
  updateZone,
  deleteZone,
  getZoneById,
  getZonesBySiteId,
  getAllZones,
  assignCourierToZone,
  removeCourierFromZone,
  getCourierZones,
  getZoneCouriers,
  getAvailableCouriersForZone,
  mergeZones,
  getZoneMergeLogs,
  getZoneMergeLogById,
} = require('../services/zone');

const router = Router();

router.post('/sites', async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    if (!name) {
      return res.status(400).json(fail('站点名称不能为空'));
    }
    const site = await createSite(name, address, phone);
    res.status(201).json(success(site, '站点创建成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('创建站点失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/sites/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone } = req.body;
    const site = await updateSite(id, name, address, phone);
    res.json(success(site, '站点更新成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('更新站点失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.delete('/sites/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteSite(id);
    res.json(success(null, '站点删除成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('删除站点失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/sites', async (req, res) => {
  try {
    const sites = await getAllSites();
    res.json(success(sites));
  } catch (err) {
    console.error('查询站点列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/sites/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const site = await getSiteById(id);
    res.json(success(site));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询站点详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/zones', async (req, res) => {
  try {
    const { site_id, name, description } = req.body;
    if (!site_id || !name) {
      return res.status(400).json(fail('站点ID和区域名称不能为空'));
    }
    const zone = await createZone(site_id, name, description);
    res.status(201).json(success(zone, '配送区域创建成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('创建配送区域失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/zones/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const zone = await updateZone(id, name, description);
    res.json(success(zone, '配送区域更新成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('更新配送区域失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.delete('/zones/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await deleteZone(id);
    res.json(success(null, '配送区域删除成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('删除配送区域失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/zones', async (req, res) => {
  try {
    const { site_id } = req.query;
    let zones;
    if (site_id) {
      zones = await getZonesBySiteId(site_id);
    } else {
      zones = await getAllZones();
    }
    res.json(success(zones));
  } catch (err) {
    console.error('查询配送区域列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/zones/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await getZoneById(id);
    res.json(success(zone));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询配送区域详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/zones/:id/available-couriers', async (req, res) => {
  try {
    const { id } = req.params;
    const couriers = await getAvailableCouriersForZone(id);
    res.json(success(couriers));
  } catch (err) {
    console.error('查询可分配快递小哥失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/courier-zones', async (req, res) => {
  try {
    const { courier_id, zone_id } = req.body;
    if (!courier_id || !zone_id) {
      return res.status(400).json(fail('快递小哥ID和区域ID不能为空'));
    }
    await assignCourierToZone(courier_id, zone_id);
    res.json(success(null, '分配成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('分配快递小哥区域失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.delete('/courier-zones', async (req, res) => {
  try {
    const { courier_id, zone_id } = req.body;
    if (!courier_id || !zone_id) {
      return res.status(400).json(fail('快递小哥ID和区域ID不能为空'));
    }
    await removeCourierFromZone(courier_id, zone_id);
    res.json(success(null, '移除成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('移除快递小哥区域失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/couriers/:id/zones', async (req, res) => {
  try {
    const { id } = req.params;
    const zones = await getCourierZones(id);
    res.json(success(zones));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询快递小哥负责区域失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/zones/:id/couriers', async (req, res) => {
  try {
    const { id } = req.params;
    const couriers = await getZoneCouriers(id);
    res.json(success(couriers));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询区域负责快递小哥失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/zones/merge', async (req, res) => {
  try {
    const { source_zone_id, target_zone_id, operator_name, remark } = req.body;
    if (!source_zone_id || !target_zone_id) {
      return res.status(400).json(fail('源区域ID和目标区域ID不能为空'));
    }
    const result = await mergeZones(
      Number(source_zone_id),
      Number(target_zone_id),
      operator_name || '系统运营',
      remark || ''
    );
    res.json(success(result, '区域合并成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('区域合并失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/zone-merge-logs', async (req, res) => {
  try {
    const { site_id, page, page_size } = req.query;
    const pageNum = page ? Number(page) : 1;
    const pageSize = page_size ? Number(page_size) : 20;
    const result = await getZoneMergeLogs(
      site_id ? Number(site_id) : null,
      pageNum,
      pageSize
    );
    res.json(success(result));
  } catch (err) {
    console.error('查询区域合并记录失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/zone-merge-logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const log = await getZoneMergeLogById(Number(id));
    res.json(success(log));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询区域合并记录详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
