const { allAsync, getAsync, runAsync } = require('../db');

async function createSite(name, address, phone) {
  const existing = await getAsync('SELECT id FROM site WHERE name = ?', [name]);
  if (existing) {
    const err = new Error('站点名称已存在');
    err.statusCode = 400;
    throw err;
  }
  const result = await runAsync(
    'INSERT INTO site (name, address, phone) VALUES (?, ?, ?)',
    [name, address || null, phone || null]
  );
  const site = await getAsync('SELECT * FROM site WHERE id = ?', [result.lastID]);
  return site;
}

async function updateSite(id, name, address, phone) {
  const site = await getAsync('SELECT * FROM site WHERE id = ?', [id]);
  if (!site) {
    const err = new Error('站点不存在');
    err.statusCode = 404;
    throw err;
  }
  if (name && name !== site.name) {
    const existing = await getAsync('SELECT id FROM site WHERE name = ? AND id != ?', [name, id]);
    if (existing) {
      const err = new Error('站点名称已存在');
      err.statusCode = 400;
      throw err;
    }
  }
  await runAsync(
    'UPDATE site SET name = ?, address = ?, phone = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
    [name || site.name, address !== undefined ? address : site.address, phone !== undefined ? phone : site.phone, id]
  );
  const updated = await getAsync('SELECT * FROM site WHERE id = ?', [id]);
  return updated;
}

async function deleteSite(id) {
  const site = await getAsync('SELECT * FROM site WHERE id = ?', [id]);
  if (!site) {
    const err = new Error('站点不存在');
    err.statusCode = 404;
    throw err;
  }
  const zoneCount = await getAsync('SELECT COUNT(*) as cnt FROM delivery_zone WHERE site_id = ?', [id]);
  if (zoneCount.cnt > 0) {
    const err = new Error('该站点下还有配送区域，无法删除');
    err.statusCode = 400;
    throw err;
  }
  const packageCount = await getAsync('SELECT COUNT(*) as cnt FROM package WHERE site_id = ?', [id]);
  if (packageCount.cnt > 0) {
    const err = new Error('该站点下还有包裹，无法删除');
    err.statusCode = 400;
    throw err;
  }
  await runAsync('DELETE FROM site WHERE id = ?', [id]);
  return true;
}

async function getSiteById(id) {
  const site = await getAsync('SELECT * FROM site WHERE id = ?', [id]);
  if (!site) {
    const err = new Error('站点不存在');
    err.statusCode = 404;
    throw err;
  }
  return site;
}

async function getAllSites() {
  const sites = await allAsync('SELECT * FROM site ORDER BY created_at DESC');
  return sites;
}

async function createZone(siteId, name, description) {
  const site = await getAsync('SELECT * FROM site WHERE id = ?', [siteId]);
  if (!site) {
    const err = new Error('站点不存在');
    err.statusCode = 404;
    throw err;
  }
  const existing = await getAsync('SELECT id FROM delivery_zone WHERE site_id = ? AND name = ?', [siteId, name]);
  if (existing) {
    const err = new Error('该站点下已存在同名配送区域');
    err.statusCode = 400;
    throw err;
  }
  const result = await runAsync(
    'INSERT INTO delivery_zone (site_id, name, description) VALUES (?, ?, ?)',
    [siteId, name, description || null]
  );
  const zone = await getAsync('SELECT * FROM delivery_zone WHERE id = ?', [result.lastID]);
  return zone;
}

async function updateZone(id, name, description) {
  const zone = await getAsync('SELECT * FROM delivery_zone WHERE id = ?', [id]);
  if (!zone) {
    const err = new Error('配送区域不存在');
    err.statusCode = 404;
    throw err;
  }
  if (name && name !== zone.name) {
    const existing = await getAsync('SELECT id FROM delivery_zone WHERE site_id = ? AND name = ? AND id != ?', [zone.site_id, name, id]);
    if (existing) {
      const err = new Error('该站点下已存在同名配送区域');
      err.statusCode = 400;
      throw err;
    }
  }
  await runAsync(
    'UPDATE delivery_zone SET name = ?, description = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
    [name || zone.name, description !== undefined ? description : zone.description, id]
  );
  const updated = await getAsync('SELECT * FROM delivery_zone WHERE id = ?', [id]);
  return updated;
}

async function deleteZone(id) {
  const zone = await getAsync('SELECT * FROM delivery_zone WHERE id = ?', [id]);
  if (!zone) {
    const err = new Error('配送区域不存在');
    err.statusCode = 404;
    throw err;
  }
  const courierCount = await getAsync('SELECT COUNT(*) as cnt FROM courier_zone WHERE zone_id = ?', [id]);
  if (courierCount.cnt > 0) {
    const err = new Error('该配送区域下还有负责的快递小哥，无法删除');
    err.statusCode = 400;
    throw err;
  }
  const packageCount = await getAsync('SELECT COUNT(*) as cnt FROM package WHERE zone_id = ?', [id]);
  if (packageCount.cnt > 0) {
    const err = new Error('该配送区域下还有包裹，无法删除');
    err.statusCode = 400;
    throw err;
  }
  await runAsync('DELETE FROM delivery_zone WHERE id = ?', [id]);
  return true;
}

async function getZoneById(id) {
  const zone = await getAsync(
    'SELECT dz.*, s.name as site_name FROM delivery_zone dz LEFT JOIN site s ON dz.site_id = s.id WHERE dz.id = ?',
    [id]
  );
  if (!zone) {
    const err = new Error('配送区域不存在');
    err.statusCode = 404;
    throw err;
  }
  return zone;
}

async function getZonesBySiteId(siteId) {
  const zones = await allAsync(
    'SELECT dz.*, s.name as site_name FROM delivery_zone dz LEFT JOIN site s ON dz.site_id = s.id WHERE dz.site_id = ? ORDER BY dz.created_at DESC',
    [siteId]
  );
  return zones;
}

async function getAllZones() {
  const zones = await allAsync(
    'SELECT dz.*, s.name as site_name FROM delivery_zone dz LEFT JOIN site s ON dz.site_id = s.id ORDER BY dz.created_at DESC'
  );
  return zones;
}

async function assignCourierToZone(courierId, zoneId) {
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courierId]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }
  const zone = await getAsync('SELECT * FROM delivery_zone WHERE id = ?', [zoneId]);
  if (!zone) {
    const err = new Error('配送区域不存在');
    err.statusCode = 404;
    throw err;
  }
  const existing = await getAsync('SELECT id FROM courier_zone WHERE courier_id = ? AND zone_id = ?', [courierId, zoneId]);
  if (existing) {
    const err = new Error('该快递小哥已负责此区域');
    err.statusCode = 400;
    throw err;
  }
  await runAsync(
    'INSERT INTO courier_zone (courier_id, zone_id) VALUES (?, ?)',
    [courierId, zoneId]
  );
  return true;
}

async function removeCourierFromZone(courierId, zoneId) {
  const existing = await getAsync('SELECT * FROM courier_zone WHERE courier_id = ? AND zone_id = ?', [courierId, zoneId]);
  if (!existing) {
    const err = new Error('该快递小哥未负责此区域');
    err.statusCode = 400;
    throw err;
  }
  await runAsync('DELETE FROM courier_zone WHERE courier_id = ? AND zone_id = ?', [courierId, zoneId]);
  return true;
}

async function getCourierZones(courierId) {
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courierId]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }
  const zones = await allAsync(
    `SELECT dz.*, s.name as site_name FROM courier_zone cz
     LEFT JOIN delivery_zone dz ON cz.zone_id = dz.id
     LEFT JOIN site s ON dz.site_id = s.id
     WHERE cz.courier_id = ? ORDER BY cz.created_at DESC`,
    [courierId]
  );
  return zones;
}

async function getZoneCouriers(zoneId) {
  const zone = await getAsync('SELECT * FROM delivery_zone WHERE id = ?', [zoneId]);
  if (!zone) {
    const err = new Error('配送区域不存在');
    err.statusCode = 404;
    throw err;
  }
  const couriers = await allAsync(
    `SELECT c.* FROM courier_zone cz
     LEFT JOIN courier c ON cz.courier_id = c.id
     WHERE cz.zone_id = ? ORDER BY c.created_at DESC`,
    [zoneId]
  );
  return couriers;
}

async function isCourierInZone(courierId, zoneId) {
  if (!zoneId) return true;
  const row = await getAsync(
    'SELECT 1 FROM courier_zone WHERE courier_id = ? AND zone_id = ?',
    [courierId, zoneId]
  );
  return !!row;
}

async function getAvailableCouriersForZone(zoneId) {
  if (!zoneId) {
    return await allAsync("SELECT * FROM courier WHERE status = 'ON_DUTY' ORDER BY created_at DESC");
  }
  const couriers = await allAsync(
    `SELECT c.* FROM courier_zone cz
     LEFT JOIN courier c ON cz.courier_id = c.id
     WHERE cz.zone_id = ? AND c.status = 'ON_DUTY'
     ORDER BY c.created_at DESC`,
    [zoneId]
  );
  return couriers;
}

module.exports = {
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
  isCourierInZone,
  getAvailableCouriersForZone,
};
