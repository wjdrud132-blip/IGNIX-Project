const managerRegions = {
  "구예진": ["동구", "남구"],
  "장현지": ["북구", "광산구"],
  "관리자3": ["서구"],
};

function getUser(reqOrUser) {
  if (!reqOrUser) return {};
  if (reqOrUser.session && reqOrUser.session.user) return reqOrUser.session.user;
  return reqOrUser;
}

function isOperator(reqOrUser) {
  const user = getUser(reqOrUser);
  return user.role === "operator";
}

function getUserName(reqOrUser) {
  const user = getUser(reqOrUser);
  return user.mgr_name || user.name || user.user_name || "";
}

function getRegions(reqOrUser) {
  const user = getUser(reqOrUser);
  if (isOperator(user)) return null;

  const name = getUserName(user).trim();
  if (managerRegions[name]) return managerRegions[name];

  const matchedName = Object.keys(managerRegions).find((key) => name.includes(key));
  return matchedName ? managerRegions[matchedName] : [];
}

function canViewLocation(reqOrUser, location) {
  return true;
}

function filterRowsByRegion(reqOrUser, rows, locationKey = "bin_loc") {
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

function buildLocationWhere(reqOrUser, fieldName) {
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
