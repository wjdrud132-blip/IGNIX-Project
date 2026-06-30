const managerRegions = {
  "구예진": ["강남구", "강동구", "관악구", "서초구"],
  "장현지": ["마포구", "노원구", "서대문구", "성동구"],
  "관리자3": ["용산구", "종로구", "송파구", "은평구", "중구"],
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
  const regions = getRegions(reqOrUser);
  if (regions === null) return true;
  if (!regions.length) return false;

  const text = String(location || "");
  return regions.some((region) => text.includes(region));
}

function filterRowsByRegion(reqOrUser, rows, locationKey = "bin_loc") {
  if (!Array.isArray(rows)) return [];
  const regions = getRegions(reqOrUser);
  if (regions === null) return rows;
  if (!regions.length) return [];

  return rows.filter((row) => canViewLocation(reqOrUser, row[locationKey]));
}

function buildLocationWhere(reqOrUser, fieldName) {
  const regions = getRegions(reqOrUser);
  if (regions === null) return { clause: "", params: [] };
  if (!regions.length) return { clause: " AND 1 = 0", params: [] };

  return {
    clause: " AND (" + regions.map(() => `${fieldName} LIKE ?`).join(" OR ") + ")",
    params: regions.map((region) => `%${region}%`),
  };
}

module.exports = {
  managerRegions,
  getRegions,
  isOperator,
  canViewLocation,
  filterRowsByRegion,
  buildLocationWhere,
};
