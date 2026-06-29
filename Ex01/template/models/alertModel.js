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
      a.alert_id,
      a.bin_id,
      a.alert_type,
      a.alert_msg,
      a.alerted_at,
      a.is_received,
      a.received_at,
      b.bin_loc,
      b.installed_at
    FROM t_alert a
    LEFT JOIN t_trashbin b ON a.bin_id = b.bin_id
    WHERE b.network_status IS NULL OR b.network_status <> 9
    ORDER BY
      CASE a.alert_type
        WHEN 'danger' THEN 1
        WHEN 'warning' THEN 2
        WHEN 'normal' THEN 3
        ELSE 4
      END,
      a.alerted_at DESC,
      a.bin_id ASC,
      a.alert_id DESC
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
  const sql = `
    UPDATE t_alert
    SET
      is_received = 'Y',
      received_at = CASE
        WHEN is_received = 'Y' THEN received_at
        ELSE NOW()
      END
    WHERE is_received <> 'Y'
  `;

  return await query(sql);
}

module.exports = {
  getLogs,
  getStats,
  markAllRead
};
