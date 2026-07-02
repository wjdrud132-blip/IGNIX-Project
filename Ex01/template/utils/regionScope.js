const managerRegions = {};

function getUser(reqOrUser) {
  if (!reqOrUser) return {};
  if (reqOrUser.session && reqOrUser.session.user) return reqOrUser.session.user;
  return reqOrUser;
}

function isOperator(reqOrUser) {
  const user = getUser(reqOrUser);
  return user.role === "operator";
}

function getRegions() {
  return null;
}

function canViewLocation() {
  return true;
}

function filterRowsByRegion(reqOrUser, rows) {
  return Array.isArray(rows) ? rows : [];
}

function dedupeRowsByLocation(rows, locationKey = "bin_loc") {
  if (!Array.isArray(rows)) return [];

  const byLocation = new Map();
  rows.forEach((row) => {
    const location = String(row[locationKey] || "").replace(/\s+/g, " ").trim();
    const key = location || `__bin_${row.bin_id}`;
    const prev = byLocation.get(key);
    if (!prev || Number(row.bin_id) < Number(prev.bin_id)) {
      byLocation.set(key, row);
    }
  });

  return Array.from(byLocation.values());
}

function buildLocationWhere() {
  return { clause: "", params: [] };
}

module.exports = {
  managerRegions,
  getRegions,
  isOperator,
  canViewLocation,
  filterRowsByRegion,
  dedupeRowsByLocation,
  buildLocationWhere,
};