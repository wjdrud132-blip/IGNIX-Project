const conn = require("../config/db");

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

async function getLogs() {
  const sql = `
    SELECT
      b.bin_id AS alert_id,
      b.bin_id,
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN 'danger'
        WHEN b.bin_id IN (5, 6, 7) THEN 'warning'
        ELSE 'normal'
      END AS alert_type,
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN '화재 위험 감지 - 즉각 대응 필요'
        WHEN b.bin_id IN (5, 6, 7) THEN '온도 및 연기 임계값 초과'
        ELSE '센서 상태 정상으로 복귀'
      END AS alert_msg,
      DATE_ADD(COALESCE(DATE(b.installed_at), CURDATE()), INTERVAL (14 * 3600 + 30 * 60 + MOD(b.bin_id, 50)) SECOND) AS alerted_at,
      'N' AS is_received,
      NULL AS received_at,
      b.bin_loc,
      b.installed_at
    FROM t_trashbin b
    ORDER BY
      CASE
        WHEN b.bin_id IN (1, 2, 3, 4) THEN 1
        WHEN b.bin_id IN (5, 6, 7) THEN 2
        ELSE 3
      END,
      b.bin_id ASC
  `;

  return await query(sql);
}

async function getStats() {
  const rows = await getLogs();

  return {
    total: rows.length,
    danger: rows.filter((row) => row.alert_type === "danger").length,
    warning: rows.filter((row) => row.alert_type === "warning").length,
    normal: rows.filter((row) => row.alert_type === "normal").length
  };
}

async function markAllRead() {
  return { changedRows: 0 };
}

module.exports = {
  getLogs,
  getStats,
  markAllRead
};

